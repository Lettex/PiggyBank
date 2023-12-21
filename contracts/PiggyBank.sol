// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

interface IUniswapV2Pair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}

contract PiggyBank is ReentrancyGuard {

    using SafeMath for uint256;

    struct Deposit {
        IERC20 token;
        uint256 amount;
        uint256 unlockTime;
    }

    mapping(address => Deposit[]) public deposits;
    mapping(IERC20 => uint256) public totalDeposits;

    // Set the contract owner
    address public owner;

    // Liquidity pool of 2 stable coins
    address public safePair = 0x7EFaEf62fDdCCa950418312c6C91Aef321375A00;

    // Fee will be divided by 100
    uint256 public feePercentage = 10;
    uint256 public earlyWithdrawFeePercentage = 100;

    // Define events
    event DepositMade(address indexed depositor, uint256 amount, uint256 unlockTime);
    event Withdrawn(address indexed depositor, uint256 amount);
    event UrgentWithdrawn(address indexed depositor, uint256 amount);
    event FeeUpdated(uint256 oldFee, uint256 newFee);

    // Fallback function to accept Ether.
    fallback() external payable {}

    // Explicit function to receive Ether.
    receive() external payable {}

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only the contract owner may perform this action");
        _;
    }

    /**
     * @dev Sets the fee percentage for deposits.
     * @param _feePercentage The new fee percentage (between 0 and 100). This will be divided by 1000 in calculations,
     * so a value of 10 equates to a 1% fee.
     *
     * Emits a {FeeUpdated} event.
     */
    function setFeePercentage(uint256 _feePercentage) external onlyOwner {
        require(_feePercentage <= 100, "Don't be greedy"); // Ensure the new fee is not excessively high
        emit FeeUpdated(feePercentage, _feePercentage); // Emit the event for setting the new fee
        feePercentage = _feePercentage;  // Set the new fee
    }

    /**
     * @dev Allows the contract owner to set a new Uniswap pair address ('safePair').
     * Useful if the Uniswap pair changes due to migrations.
     * @param _pair The address of the new Uniswap pair
     *
     */
    function setPair(address _pair) external onlyOwner {
        safePair = _pair;  // Set the new pair
    }

    /**
     * @dev Allows a user to make a deposit of a specific token for a certain duration.
     * @param token The ERC20 token that the user is depositing.
     * @param amount The amount of the token to deposit.
     * @param duration The period (in seconds) for which the deposit should stay locked.
     * @param depositId The ID of the deposit in the user's deposit array.
     * If the depositId is equal to the length of the user's deposit array, a new deposit will be created.
     * Otherwise, it tries to add the amount to an existing deposit of the same token and extends its unlockTime by the duration.
     *
     * Emits a {DepositMade} event.
     */
    function deposit(
        IERC20 token,
        uint256 amount,
        uint256 duration,
        uint256 depositId
    )
    external
    {
        uint256 feeAmount = amount.mul(feePercentage).div(1000);
        uint256 depositAmount = amount.sub(feeAmount);

        token.transferFrom(msg.sender, address(this), amount);

        // Transferring fee to the owner
        token.transfer(owner, feeAmount);
        uint256 unlockTime;
        if (depositId < deposits[msg.sender].length) {
            Deposit storage d = deposits[msg.sender][depositId];
            require(d.token == token, "Tokens mismatch");
            d.amount = d.amount.add(depositAmount);
            unlockTime = d.unlockTime.add(duration);
            d.unlockTime = unlockTime;
        } else {
            unlockTime = block.timestamp.add(duration);
            deposits[msg.sender].push(Deposit({
                token: token,
                amount: depositAmount,
                unlockTime: unlockTime
            }));
        }
        totalDeposits[token] = totalDeposits[token].add(depositAmount);
        emit DepositMade(msg.sender, depositAmount, unlockTime);
    }

    /**
    * @dev Allows a user to withdraw a specific deposit.
    * @param depositId The ID of the deposit to be withdrawn. The ID corresponds to the index in the deposits[] array for the deposit.
    *
    * Users can withdraw their deposits without a fee after the unlock time.
    * If the Uniswap pool's prices are NOT at a safe level user can withdraw without check for unlock time.
    *
    * Emits a {Withdrawn} event.
    */
    function withdraw(uint256 depositId) external nonReentrant {
        require(depositId < deposits[msg.sender].length, "Deposit does not exist");

        Deposit storage d = deposits[msg.sender][depositId];

        if (checkUniswapPool()) {
            require(block.timestamp >= d.unlockTime, "Deposit is still locked");
        }
        require(d.amount > 0, "Deposit already withdrawn");

        uint256 withdrawingAmount = d.amount;
        d.amount = 0;  // clear the deposit amount, before transfer for safety reasons

        d.token.transfer(msg.sender, withdrawingAmount);
        totalDeposits[d.token] = totalDeposits[d.token].sub(withdrawingAmount);
        emit Withdrawn(msg.sender, withdrawingAmount);

    }
    /**
     * @dev Allows a user to urgently withdraw a specific deposit before the unlock time.
     * @param depositId The ID of the deposit to be withdrawn. The ID is essentially the index in the deposits[] array for that deposit.
     *
     * Users are charged an early withdrawal fee for this operation. But if the Uniswap pool's prices are NOT at a safe level, the fee is waived off.
     *
     * Emits an {UrgentWithdrawn} event.
     */
    function urgentWithdraw(uint256 depositId) external nonReentrant {
        require(depositId < deposits[msg.sender].length, "Deposit does not exist");

        Deposit storage d = deposits[msg.sender][depositId];
        require(d.amount > 0, "Deposit already withdrawn");

        uint256 feeAmount = d.amount.mul(earlyWithdrawFeePercentage).div(1000);
        if (!checkUniswapPool()) {
            feeAmount = 0;
        }

        uint256 totalWithdraw = d.amount;
        uint256 withdrawingAmount = d.amount.sub(feeAmount);

        d.amount = 0;  // clear the deposit amount
        d.token.transfer(owner, feeAmount);  // transfer the fee to the owner
        d.token.transfer(msg.sender, withdrawingAmount);  // transfer the remainder to the user
        totalDeposits[d.token] = totalDeposits[d.token].sub(totalWithdraw);
        emit UrgentWithdrawn(msg.sender, withdrawingAmount);
    }

    /**
     * @dev Allows the contract owner to recover any ERC20 token sent to the contract address by mistake.
     * It checks first that it is not attempting to withdraw tokens that are part of the total user deposits.
     * @param token The token to be recovered.
     *
     * The contract keeps track of the total amount of each token type that has been deposited by users.
     * This function will only allow the contract owner to withdraw tokens that exceed this total, ensuring that user deposits cannot be erroneously withdrawn.
     *
     */
    function recoverERC20(IERC20 token) external onlyOwner {
        uint256 balance = token.balanceOf(address(this));
        require(balance > totalDeposits[token], "No excess tokens to recover");
        uint256 recoverable = balance.sub(totalDeposits[token]);
        token.transfer(owner, recoverable);
    }

    /**
     * @dev This function checks the price resistance of a Uniswap pair.
     *
     * The function calculates the relative price difference between the two reserves of a UniswapV2 pair.
     * If the relative price difference is more than 5 percent in either direction, it returns false.
     * Otherwise, it returns true.
     * This can be used to understand if the pool prices are at a safe level.
     *
     * @return bool Returns true if the relative price difference between reserves is within 5 percent.
     */
    function checkUniswapPool() public view returns (bool) {
        IUniswapV2Pair pair = IUniswapV2Pair(safePair);
        (uint256 reserve0, uint256 reserve1,) = pair.getReserves();
        if (reserve0 == 0 || reserve1 == 0) {
            return false;
        }
        if (reserve0.mul(100).div(reserve1) > 105 || reserve1.mul(100).div(reserve0) > 105) {
            return false;
        } else {
            return true;
        }
    }

    /**
     * @dev Allows the contract owner to recover any Ether accidentally sent to the contract.
     *
     * This function transfers the total Ether balance of the contract to the owner.
     */
    function recover() external onlyOwner {
        uint256 balance = address(this).balance;
        payable(owner).transfer(balance);
    }
}