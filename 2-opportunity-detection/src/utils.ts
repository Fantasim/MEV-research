import { FullMath, TickMath } from "@uniswap/v3-sdk";
import { ethers } from "ethers";
import JSBI from "jsbi";
import { BigNumberish } from "@ethersproject/bignumber";

export function convertToDecimal(value: BigInt, decimals: number) {
  const valueStr = value.toString();
  let integerPart = valueStr.slice(0, -decimals) || "0";
  let decimalPart = valueStr.slice(-decimals).padStart(decimals, '0');
  return parseFloat(`${integerPart}.${decimalPart}`)
}
export const areSymbolsEqual = (symbol1: string, symbol2: string) => {
  return symbol1.toLowerCase() === symbol2.toLowerCase()
}

export const areAddressesEqual = (address1: string, address2: string) => {
  return address1.toLowerCase() === address2.toLowerCase()
}

export function tickToWord(tick: number, tickSpacing: number): number {
    let compressed = Math.floor(tick / tickSpacing)
    if (tick < 0 && tick % tickSpacing !== 0) {
      compressed -= 1
    }
    return tick >> 8
}

export const quitProgram = () => process.kill(process.pid, 'SIGINT');

export const sqrtPriceX96ToToken0PriceInToken1 = (sqrtPriceX96: BigNumberish, decimalToken0: number, decimalToken1: number) => {
  const numerator1 = BigInt(sqrtPriceX96.toString()) * BigInt(sqrtPriceX96.toString())
  const numerator2 = 10n ** BigInt(decimalToken0)
  const shift = JSBI.leftShift(JSBI.BigInt(1), JSBI.BigInt(192))
  const res = FullMath.mulDivRoundingUp(JSBI.BigInt(numerator1.toString()), JSBI.BigInt(numerator2.toString()), shift)
  
  let r = parseFloat(res.toString())

  return parseFloat((r / 10 ** decimalToken1).toFixed(decimalToken1))
}

export const sqrtPriceX96ToToken1PriceInToken0 = (sqrtPriceX96: BigNumberish, decimalToken0: number, decimalToken1: number) => {
  const r = sqrtPriceX96ToToken0PriceInToken1(sqrtPriceX96, decimalToken0, decimalToken1)
  return parseFloat((1 / r).toFixed(decimalToken0))
}


export const tickToRatio = (tick: number) => {
  const inputAmount = 1
  const baseTokenDecimals = 18

  const sqrtRatioX96 = TickMath.getSqrtRatioAtTick(tick)
  const ratioX192 = JSBI.multiply(sqrtRatioX96, sqrtRatioX96)
  const baseAmount = JSBI.BigInt( inputAmount * (10 ** baseTokenDecimals))
  const shift = JSBI.leftShift( JSBI.BigInt(1), JSBI.BigInt(192))
  const quoteAmount = FullMath.mulDivRoundingUp(ratioX192, baseAmount, shift)
  const r = parseFloat(ethers.formatEther(quoteAmount.toString()))

  return r
}