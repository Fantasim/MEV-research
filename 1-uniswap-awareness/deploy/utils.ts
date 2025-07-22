import { ethers } from "hardhat";
import { string } from "hardhat/internal/core/params/argumentTypes";
import fs from 'fs'
import { Contract, BigNumber } from "ethers"
import { FullMath, Pool, Position, TickMath, encodeSqrtRatioX96, nearestUsableTick ,} from "@uniswap/v3-sdk";
import JSBI from 'jsbi';


type ERC20 = {
    [id: string]: string;
}

//prix
export const ratioToTick = (ratio1to0: number, tickSpacing: number) => {
  const decimals = 18

  const rformat = ratio1to0 * (10 ** decimals)
  const sqrt = encodeSqrtRatioX96(rformat, 10 ** 18)
  const tick = TickMath.getTickAtSqrtRatio(sqrt);

  return nearestUsableTick(tick, tickSpacing)
}


export const SQRTX96ToRatio = (sqrtX96: BigNumber) => {
  const baseAmount = JSBI.BigInt( 1 * (10 ** 18))
  const shift = JSBI.leftShift(JSBI.BigInt(1), JSBI.BigInt(192))
  const quoteAmount = FullMath.mulDivRoundingUp(JSBI.BigInt(sqrtX96.pow(2).toString()), baseAmount, shift)
  const r = parseFloat(ethers.utils.formatEther(quoteAmount.toString()))
  return r
}

export const tickToRatio = (tick: number) => {
  const inputAmount = 1
  const baseTokenDecimals = 18

  const sqrtRatioX96 = TickMath.getSqrtRatioAtTick(tick)
  const ratioX192 = JSBI.multiply(sqrtRatioX96, sqrtRatioX96)
  const baseAmount = JSBI.BigInt( inputAmount * (10 ** baseTokenDecimals))
  const shift = JSBI.leftShift( JSBI.BigInt(1), JSBI.BigInt(192))
  const quoteAmount = FullMath.mulDivRoundingUp(ratioX192, baseAmount, shift)
  const r = parseFloat(ethers.utils.formatEther(quoteAmount.toString()))

  return r
}


export function calculateLiquidityForToken0(pool: Pool, amount: JSBI, tickLower: number, tickUpper: number) {
  return Position.fromAmount0({
    pool,
    tickLower,
    tickUpper,
    amount0: amount,
    useFullPrecision: true
  }).liquidity;
}

export function calculateLiquidityForToken1(pool: Pool, amount: JSBI, tickLower: number, tickUpper: number) {
  return Position.fromAmount1({
    pool,
    tickLower,
    tickUpper,
    amount1: amount,
  }).liquidity;
}


interface Contracts { 
    uniswapSuite: {
      UniswapV3Factory: string,
      SwapRouter: string,
      NFTDescriptor: string,
      NonfungibleTokenPositionDescriptor: string,
      NonfungiblePositionManager: string
    },
    token: ERC20,
    pools: ERC20
}

export const saveContractJSONFile = (contracts: Contracts) => {
    fs.writeFileSync('./deployed.json', JSON.stringify(contracts, null, 2))
}

const initContractJSONFile = (): Contracts => {
    try {
        const t = fs.existsSync('./deployed.json')
        if (!t) {
            return {
                uniswapSuite: {
                    UniswapV3Factory: '',
                    SwapRouter: '',
                    NFTDescriptor: '',
                    NonfungibleTokenPositionDescriptor: '',
                    NonfungiblePositionManager: ''
                },
                token: {},
                pools: {}
            }
        }
        const data = fs.readFileSync('./deployed.json', 'utf8')
        return JSON.parse(data)
    } catch (e){
        console.log(e)
        process.exit(1)
    }
}

export const linkLibraries = ({ bytecode, linkReferences }: any, libraries: any) => {
    Object.keys(linkReferences).forEach((fileName) => {
      Object.keys(linkReferences[fileName]).forEach((contractName) => {
        if (!libraries.hasOwnProperty(contractName)) {
          throw new Error(`Missing link library name ${contractName}`)
        }
        const address = ethers.utils
          .getAddress(libraries[contractName])
          .toLowerCase()
          .slice(2)
        linkReferences[fileName][contractName].forEach(
          ({ start, length }: any) => {
            const start2 = 2 + start * 2
            const length2 = length * 2
            bytecode = bytecode
              .slice(0, start2)
              .concat(address)
              .concat(bytecode.slice(start2 + length2, bytecode.length))
          }
        )
      })
    })
    return bytecode
}


export let CONTRACTS = initContractJSONFile()
