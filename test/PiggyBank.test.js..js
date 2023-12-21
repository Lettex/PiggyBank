// Importing the required libraries
const {ethers} = require('hardhat');
const {expect} = require('chai');
const hre = require("hardhat");
let holder = '0xD183F2BBF8b28d9fec8367cb06FE72B88778C86B';
let usdt = '0x55d398326f99059fF775485246999027B3197955';
const IERC20_SOURCE = "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20";

async function get100USDT(destinationAddr) {
    return await getToken(usdt, holder, destinationAddr, '100');
}

async function getToken(tokenAddr, ownerAddr, destinationAddr, amount) {
    // Impersonate the owner account
    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [ownerAddr],
    });

    // Create a signer from the owner's account
    const signer = await ethers.provider.getSigner(ownerAddr);

    // Get contract instance
    const tokenContract = await ethers.getContractAt(IERC20_SOURCE, tokenAddr, signer);

    try {
        // Attempt to transfer the tokens
        await tokenContract.transfer(
            destinationAddr,
            ethers.utils.parseEther(amount),
            {gasLimit: 4100000}
        );
        return true; // If transfer succeeds, return true
    } catch (error) {
        console.error("An error occurred while transferring tokens:", error);
        return false; // If transfer fails, catch the error and return false
    }
}

describe('PiggyBank', function () {
    this.timeout(100000);
    let PiggyBank;
    let piggyBank;
    let owner;
    let addr1;
    let addr2;
    let addrs;

    before(async function () {
        PiggyBank = await ethers.getContractFactory("PiggyBank");
        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

        piggyBank = await PiggyBank.deploy();
        await piggyBank.deployed();
        await get100USDT(addr1.address);
    });

    describe('Fee', function () {
        it('should set the new fee correctly', async function () {
            const initialFee = await piggyBank.feePercentage();

            // New fee to be set
            const newFee = 20;

            // The contract owner sets the new fee
            await piggyBank.connect(owner).setFeePercentage(newFee);

            const finalFee = await piggyBank.feePercentage();

            expect(finalFee).to.not.equal(initialFee);
            expect(finalFee).to.equal(newFee);
        });
        it('should revert if fee percentage is larger than 100', async function () {
            // Attempt to set a fee of over 100
            const badFee = 101;

            // Expect the transaction to be reverted
            await expect(piggyBank.connect(owner).setFeePercentage(badFee))
                .to.be.revertedWith("Don't be greedy");
        });
        it('should revert if setFeePercentage is called by an account other than the owner', async function () {
            const newFee = 10;

            // Expect the transaction to be reverted due to lack of permissions
            await expect(piggyBank.connect(addr1).setFeePercentage(newFee))
                .to.be.revertedWith("Only the contract owner may perform this action");
        });
        it('should correctly set fee to the minimum value of 0', async function () {
            // Set fee to 0
            await piggyBank.connect(owner).setFeePercentage(0);

            // Check that the fee is now 0
            const fee = await piggyBank.feePercentage();
            expect(fee).to.equal(0);
        });

        it('should correctly set fee to the maximum value of 100', async function () {
            // Set fee to 100
            await piggyBank.connect(owner).setFeePercentage(100);

            // Check that the fee is now 100
            const fee = await piggyBank.feePercentage();
            expect(fee).to.equal(100);
        });
    });
    describe('Uniswap', function(){
        it('default pair should return true', async function () {
            // Call the checkUniswapPool function
            const poolCheck = await piggyBank.checkUniswapPool();

            // Check that the function returns true
            expect(poolCheck).to.be.true;
        });
        it('should correctly set a new pair', async function () {
            // The new pair address
            const newPair = "0x531FEbfeb9a61D948c384ACFBe6dCc51057AEa7e";

            // Set the new pair
            await piggyBank.connect(owner).setPair(newPair);

            // Fetch the pair again from the contract
            const finalPair = await piggyBank.safePair();

            // Check the pair is updated correctly
            expect(finalPair).to.equal(newPair);
        });
        it('ETH/USDT pair should return false', async function () {
            // Call the checkUniswapPool function
            const poolCheck = await piggyBank.checkUniswapPool();

            // Check that the function returns true
            expect(poolCheck).to.be.false;

            //Revert to default pair for future tests
            await piggyBank.connect(owner).setPair('0x7EFaEf62fDdCCa950418312c6C91Aef321375A00');
        });
    });
    describe('Recovery',function(){
        it('should successfully recover ERC20 tokens', async function () {
            // Transfer 100 USDT tokens to the contract
            const transferSuccess = await get100USDT(piggyBank.address);
            expect(transferSuccess).to.be.true;

            // Get a handle for the USDT token contract
            const tokenContract = await ethers.getContractAt("IERC20", usdt, owner);

            // Initial owner balance
            const initialBalance = await tokenContract.balanceOf(owner.address);

            // Recover tokens
            await piggyBank.connect(owner).recoverERC20(usdt);

            // Final owner balance
            const finalBalance = await tokenContract.balanceOf(owner.address);

            // Check balance was responsibly incremented
            expect(finalBalance).to.be.gt(initialBalance);
        });
        it("should successfully recover native tokens", async function () {

            // Define the amount to be sent and later recovered
            const amountToSend = ethers.utils.parseEther("1");

            // Send ETH to contract from the owner
            await owner.sendTransaction({
                to: piggyBank.address,
                value: amountToSend,
                gasLimit: 210000
            });

            // Initial owner's ETH balance
            const initialBalance = await ethers.provider.getBalance(owner.address);

            // Check that ETH was successfully sent
            let contractBalance = await ethers.provider.getBalance(piggyBank.address);
            expect(contractBalance).to.equal(amountToSend);

            // Recover the ETH sent to the contract
            await piggyBank.connect(owner).recover();

            // Final owner balance
            const finalBalance = await ethers.provider.getBalance(owner.address);

            // Check that owner's balance has increased after the recover function call
            expect(finalBalance).to.be.gt(initialBalance);

            // Check that contract has no ETH left after recovery
            contractBalance = await ethers.provider.getBalance(piggyBank.address);
            expect(contractBalance).to.equal(0);
        });
    });
    describe('Bank',function(){
        it("should allow a successful deposit", async function () {
            // Get reference to token contract
            const ERC20 = await ethers.getContractAt("IERC20", usdt, owner);

            // Transfer USDT to addr1
            const transferAmount = ethers.utils.parseUnits("50", 18);
            await get100USDT(addr1.address);

            // Approve the contract to spend USDT tokens on behalf of addr1
            await ERC20.connect(addr1).approve(piggyBank.address, transferAmount);
            const depositDuration = 1000;

            try {
                // Deposit tokens into the contract
                await piggyBank.connect(addr1).deposit(usdt, transferAmount, depositDuration, "10");
            } catch (error) {
                console.error("Failed to deposit USDT:", error);
                throw error;
            }

            let deposit;

            try {
                // Get the new deposit info
                deposit = await piggyBank.deposits(addr1.address, 0);
            } catch (error) {
                console.error("Failed to get deposit info:", error);
                throw error;
            }

            // Calculate the expected deposit amount after fee deduction
            const feePercentage = await piggyBank.feePercentage();
            const expectedDepositAmount = transferAmount.sub(transferAmount.mul(feePercentage).div(1000));

            // Check the deposit was successful and for the correct amount
            expect(deposit.amount).to.equal(expectedDepositAmount);

            // Check the deposit was made for the correct token
            expect(deposit.token).to.equal(usdt);

            // Check the unlockTime is correct
            const expectedUnlockTime = (await ethers.provider.getBlock('latest')).timestamp + depositDuration;
            expect(deposit.unlockTime).to.be.closeTo(expectedUnlockTime, 10); // Allow for some time discrepancy
        });
        it("should allow a successful withdrawal", async function () {
            const depositDuration = 60 * 60 * 24 * 30; // 30 days

            try {
                // Advancing time by 30 days
                await ethers.provider.send("evm_increaseTime", [depositDuration]);
                await ethers.provider.send("evm_mine");
            } catch (error) {
                console.error("Failed to advance time:", error);
                throw error;
            }

            const ERC20 = await ethers.getContractAt("IERC20", usdt, addr1);

            const beforeWithdrawalBalance = await ERC20.balanceOf(addr1.address);

            try {
                // Withdrawing deposit
                await piggyBank.connect(addr1).withdraw(0);
            } catch (error) {
                console.error("Failed to withdraw deposit:", error);
                throw error;
            }

            const afterWithdrawalBalance = await ERC20.balanceOf(addr1.address);

            try {
                // Get the updated deposit info
                const deposit = await piggyBank.deposits(addr1.address, 0);

                // Check the withdrawal was successful and the deposit amount is now 0
                expect(deposit.amount).to.equal(0);

                // Check token balance increased after withdrawal
                expect(afterWithdrawalBalance).to.gt(beforeWithdrawalBalance);

            } catch (error) {
                console.error("Failed to verify withdrawal:", error);
                throw error;
            }
        });
    });

});