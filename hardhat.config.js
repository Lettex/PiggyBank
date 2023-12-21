const {privateKey, bscscanApiKey, testnetPrivateKey} = require('./secrets.json');

require("@nomicfoundation/hardhat-toolbox");
require('@nomiclabs/hardhat-ethers');
require("@nomiclabs/hardhat-etherscan");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {

  networks: {
    testnet: {
      url: `https://data-seed-prebsc-1-s1.binance.org:8545`,
      accounts: [testnetPrivateKey]
    },
    mainnet: {
      url: `https://bsc-dataseed.binance.org/`,
      accounts: [privateKey]
    },
    hardhat: {
      forking: {
        url: "https://rpc.ankr.com/bsc"
      }
    }
  },

  etherscan: {
    apiKey: {
      bsc: bscscanApiKey
    }
  },

  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000
      }
    }
  },
  mocha: {
    timeout: 100000000
  }
};

