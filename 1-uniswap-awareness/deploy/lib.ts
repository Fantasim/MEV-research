import { ethers  } from 'hardhat'
import { Contract } from "ethers"

export const getERC20Balance = async (tokenAddress: string, account: string) => {
    const provider = ethers.provider
    const tokenContract = new Contract(tokenAddress, require('../artifacts/contracts/ERC20.sol/ERC20Token.json').abi, provider as any)
    return ethers.utils.formatEther(await tokenContract.balanceOf(account))
  }
  
  export async function getPoolData(poolContract: Contract) {
    const [tickSpacing, fee, liquidity, slot0] = await Promise.all([
      poolContract.tickSpacing(),
      poolContract.fee(),
      poolContract.liquidity(),
      poolContract.slot0(),
    ])
  
    return {
      tickSpacing: tickSpacing,
      fee: fee,
      liquidity: liquidity,
      sqrtPriceX96: slot0[0],
      tick: slot0[1],
    }
  }