import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
require("@nomiclabs/hardhat-ethers");

let mnemonic = 'test '.repeat(11) + 'junk'

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",

    }
  },

  networks: {
    anvil: { 
      url: 'http://localhost:8545',
      accounts: { mnemonic: mnemonic } 
    },
  },
  
};

export default config;
