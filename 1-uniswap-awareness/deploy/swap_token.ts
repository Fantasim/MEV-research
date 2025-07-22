import { BigNumber, Contract } from "ethers"
import { ethers } from "hardhat";
import { CONTRACTS } from "./utils"
import { getERC20Balance, getPoolData } from './lib'
import {Pool, nearestUsableTick, TickMath, Trade, Route, SwapRouter} from '@uniswap/v3-sdk'
import { Token, CurrencyAmount, TradeType, Percent  }from '@uniswap/sdk-core'
import { artifacts } from "./constant"
import JSBI from 'jsbi';
import { parseEther } from "ethers/lib/utils";

interface ISwapParams {
    coinQuoteSymbol: string
    coinPurchasedSymbol: string
    amountQuote: BigNumber
    fee: number
}

const getPool = async (key: string) => {
    const poolAddress = CONTRACTS.pools[key]
    if (!poolAddress) {
      throw new Error('Pool not found')
    }
      const list = await ethers.getSigners()
      const signer = list[10]
  
      const poolContract = new Contract(poolAddress, artifacts.UniswapV3Pool.abi, signer as any)

      const poolData = await getPoolData(poolContract)
  
      const token0 = new Contract(await poolContract.token0(), artifacts.ERC20.abi,  signer as any)
      const token1 = new Contract(await poolContract.token1(), artifacts.ERC20.abi,  signer as any)
  
    let liquidity = await poolContract.liquidity()
    let { sqrtPriceX96 } = await poolContract.slot0()
    liquidity = JSBI.BigInt(liquidity.toString())
    sqrtPriceX96 = JSBI.BigInt(sqrtPriceX96.toString())
  
   return new Pool(
      new Token(31337, token0.address, 18, await token0.symbol(), await token0.symbol()),
      new Token(31337, token1.address, 18, await token1.symbol(), await token1.symbol()),
      poolData.fee,
      poolData.sqrtPriceX96.toString(),
      poolData.liquidity.toString(),
      poolData.tick,
      [
        {
          index: nearestUsableTick(TickMath.MIN_TICK, poolData.tickSpacing),
          liquidityNet: liquidity,
          liquidityGross: liquidity,
        },
        {
          index: nearestUsableTick(TickMath.MAX_TICK, poolData.tickSpacing),
          liquidityNet: JSBI.multiply(liquidity, JSBI.BigInt('-1')),
          liquidityGross: liquidity,
        }
      ]
    )
}

  

export const swapToken = async (swapCallParameters: ISwapParams) => {
    const { coinQuoteSymbol, coinPurchasedSymbol, amountQuote, fee } = swapCallParameters
    
    const coinQuote = new Token(31337, CONTRACTS.token[coinQuoteSymbol], 18, coinQuoteSymbol, coinQuoteSymbol)
    const coinPurchased = new Token(31337, CONTRACTS.token[coinPurchasedSymbol], 18, coinPurchasedSymbol, coinPurchasedSymbol)
  
    const isCoinQuoteFirst = coinQuote.address < coinPurchased.address
    const key = `${isCoinQuoteFirst ? coinQuoteSymbol : coinPurchasedSymbol}-${isCoinQuoteFirst ? coinPurchasedSymbol : coinQuoteSymbol}-${fee}`
  
    const list = await ethers.getSigners()
    const signer = list[10] as any
  
    const coinQuoteContract = new Contract(coinQuote.address, artifacts.ERC20.abi, signer as any)
    const coinPurchasedContract = new Contract(coinPurchased.address, artifacts.ERC20.abi, signer as any)
  
  
    function swapOptions(options: any) {
      return Object.assign(
          {
              slippageTolerance: new Percent(10, 100),
              recipient: signer.address,
              deadline: Date.now(),
          },
          options
      )
    }
  
    const pool = await getPool(key)
  
    const approveTx = await coinQuoteContract.approve(CONTRACTS.uniswapSuite.SwapRouter, amountQuote.toString());
    // Wait for the transaction to be mined
    await approveTx.wait();
  
    //trade
    const amount = CurrencyAmount.fromRawAmount(coinQuote, amountQuote.toString())
    const route = new Route([pool], coinQuote, coinPurchased)
    const trade = await Trade.fromRoute(route, amount, TradeType.EXACT_INPUT)

    //swap
    const params = SwapRouter.swapCallParameters(trade, swapOptions({}))
  

    const beforeCoinQuote = await getERC20Balance(coinQuote.address, signer.address)    
    const beforeCoinPurchased = await getERC20Balance(coinPurchased.address, signer.address)    
  
    const tx = await signer.sendTransaction({
        data: params.calldata,
        to: CONTRACTS.uniswapSuite.SwapRouter,
        value: params.value,
        from: signer.address,
        gasLimit: 1000000
    })
    const receipt = await tx.wait()

    const afterCoinQuote = await getERC20Balance(coinQuote.address, signer.address)    
    const afterCoinPurchased = await getERC20Balance(coinPurchased.address, signer.address)  


    console.log('Swap OK:', `-${parseFloat(beforeCoinQuote) - parseFloat(afterCoinQuote)} ${coinQuoteSymbol}` , 'for', `+${parseFloat(afterCoinPurchased) - parseFloat(beforeCoinPurchased)} ${coinPurchasedSymbol}`)
  }