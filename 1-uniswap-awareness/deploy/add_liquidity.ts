import { BigNumber, Contract, Signer, ethers } from "ethers"
import { artifacts } from "./constant"
import { getERC20Balance, getPoolData } from "./lib"
import { Pool, Position, nearestUsableTick } from "@uniswap/v3-sdk"
import { Token } from "@uniswap/sdk-core"
import { CONTRACTS, calculateLiquidityForToken0, calculateLiquidityForToken1 } from "./utils"
import JSBI from "jsbi"

export const addLiquidity = async (poolContract: Contract, manager: Contract, target: {tokenAddress: string, amount: BigNumber}, tick: {upper: number, lower: number}, signer: Signer) => {

    const poolData = await getPoolData(poolContract)
  
    const token0 = new Contract(await poolContract.token0(), artifacts.ERC20.abi, signer)
    const token1 = new Contract(await poolContract.token1(), artifacts.ERC20.abi, signer)
  
    const pool = new Pool(
      new Token(31337, token0.address, 18, 'Token0', 'Token0'),
      new Token(31337, token1.address, 18, 'Token1', 'Token1'),
      poolData.fee,
      poolData.sqrtPriceX96.toString(),
      poolData.liquidity.toString(),
      poolData.tick
    )
  
    const tickLower = nearestUsableTick(tick.lower, poolData.tickSpacing)  //nearestUsableTick(poolData.tick, poolData.tickSpacing) - poolData.tickSpacing * 10
    const tickUpper = nearestUsableTick(tick.upper, poolData.tickSpacing) //nearestUsableTick(poolData.tick, poolData.tickSpacing) + poolData.tickSpacing * 10
  
    const fn = token0.address === target.tokenAddress ? calculateLiquidityForToken0 : calculateLiquidityForToken1
    const nLiquidity = await fn(pool, JSBI.BigInt(target.amount), tickLower, tickUpper)
  
    const position = new Position({
      pool: pool,
      liquidity: nLiquidity.toString(),
      tickLower: tickLower,
      tickUpper: tickUpper,
    })
  
    const amount0 = position.mintAmounts.amount0
    const amount1 = position.mintAmounts.amount1
  
    BigNumber.from(amount0.toString()).gt(0) && await token0.connect(signer).approve(CONTRACTS.uniswapSuite.NonfungiblePositionManager, BigNumber.from(amount0.toString()))
    BigNumber.from(amount1.toString()).gt(0) && await token1.connect(signer).approve(CONTRACTS.uniswapSuite.NonfungiblePositionManager, BigNumber.from(amount1.toString()))
    // await approveTX.wait(1)
  
    const params = {
      token0: token0.address,
      token1: token1.address,
      fee: poolData.fee,
      tickLower,
      tickUpper,
      amount0Desired: amount0.toString(),
      amount1Desired: amount1.toString(),
      amount0Min: 0,
      amount1Min: 0,
      recipient: await signer.getAddress(),
      deadline: Math.floor(Date.now() / 1000) + (60 * 10)
    }
  
    const before0 = parseInt(await getERC20Balance(token0.address, await signer.getAddress()))
    const before1 = parseInt(await getERC20Balance(token1.address, await signer.getAddress()))
    const tx = await manager.connect(signer).mint(
      params,
      { gasLimit: '1000000' }
    )
    await tx.wait(1)
    const after0 = parseInt(await getERC20Balance(token0.address, await signer.getAddress()))
    const after1 = parseInt(await getERC20Balance(token1.address, await signer.getAddress()))
    const d = await getPoolData(poolContract)
  
    const symb0 = await token0.symbol()
    const symb1 = await token1.symbol()
  
    const poolData2 = await getPoolData(poolContract)
  
    const feesPercent = (d.fee / 10000)
    console.log(`${parseInt(ethers.utils.formatEther(poolData2.liquidity)).toLocaleString()} LP added (${symb0}: ${before0 - after0}, ${symb1}: ${before1 - after1}) to the pool ${symb0}-${symb1} (fees: ${feesPercent}%) `)
  }