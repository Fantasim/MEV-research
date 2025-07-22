import { ethers } from "hardhat";
import WETH9 from './WETH9.json';
import { SwapRouter } from "@uniswap/v3-sdk";
import { CONTRACTS, SQRTX96ToRatio, calculateLiquidityForToken0, calculateLiquidityForToken1, linkLibraries, ratioToTick, saveContractJSONFile, tickToRatio } from "./utils";
import { BigNumber, Contract, Signer, Transaction } from "ethers";
import {Pool,Position, nearestUsableTick, encodeSqrtRatioX96, TickMath, FullMath, tickToPrice, TICK_SPACINGS, Trade, Route} from '@uniswap/v3-sdk'
import { Token, BigintIsh, CurrencyAmount, TradeType, Percent  }from '@uniswap/sdk-core'
import JSBI from 'jsbi';
import { parseEther } from "ethers/lib/utils";
import { artifacts } from "./constant";
import { swapToken } from "./swap_token";
import { getERC20Balance, getPoolData } from "./lib";
import { addPool } from "./add_pool";
import { addLiquidity } from "./add_liquidity";



const provider = ethers.provider

const deployTokens = async () => {
  const tokens = [
    { name: "Cartesi", symbol: "CTSI", initialSupply: ethers.utils.parseEther("1000000000") },
    { name: "Tether USD", symbol: "USDT", initialSupply: ethers.utils.parseEther("100000000000") },
    { name: "Coinbase USD", symbol: "USDC", initialSupply: ethers.utils.parseEther("100000000000") },
    { name: "Injective", symbol: "INJ", initialSupply: ethers.utils.parseEther("100000000") },
  ]
  const [owner ] = await ethers.getSigners() as any

  CONTRACTS.token = {}

  const ERC20Factory = await ethers.deployContract("ERC20Factory");
  await ERC20Factory.deployed()

  console.log('ERC20 TOKENS:\n')

  console.log(`ERC20Factory deployed to ${ERC20Factory.address}`);

  for (const token of tokens) {
    
    const tx = await ERC20Factory.createToken(token.name, token.symbol, token.initialSupply);
    await tx.wait();
    const tokenAddress = await ERC20Factory.getTokenAddress(token.symbol)

    CONTRACTS.token[token.symbol] = tokenAddress
    console.log(`${token.name} (${token.symbol}) and initial supply ${ethers.utils.formatEther(token.initialSupply) } at contract address ${tokenAddress}`);

    const tokenContract = new Contract(tokenAddress, artifacts.ERC20.abi, owner)
    const list = await ethers.getSigners() as any
    
    for (let i = 1; i <= 10; i++) {
      const amount = {
        CTSI: ethers.utils.parseEther('10000000'),
        USDT: ethers.utils.parseEther('1000000000'),
        USDC: ethers.utils.parseEther('1000000000'),
        INJ: ethers.utils.parseEther('1000000')
      }[token.symbol]

      const r = tokenContract.connect(owner).transfer(list[i].address, amount)
      if (i == 10){
        const t = await r
        await t.wait(1)
      }
    }
  }

  const Weth = new ethers.ContractFactory(WETH9.abi, WETH9.bytecode, owner);
  const weth = await Weth.deploy();
  await weth.deployed()
  console.log(`WETH deployed to ${weth.address}`)
  CONTRACTS.token['WETH'] = weth.address

  saveContractJSONFile(CONTRACTS)
}

const deployUniswapSuite = async () => {
  
  console.log('\n\nUNISWAP SUITE:\n')
  const [owner] = await ethers.getSigners() as any
  const WETH = CONTRACTS.token['WETH']
  if (!WETH) {
    return console.error('WETH not found in deployed.json')
  }

  const Factory = new ethers.ContractFactory(artifacts.UniswapV3Factory.abi, artifacts.UniswapV3Factory.bytecode, owner);
  const factory = await Factory.deploy();
  await factory.deployed()

  CONTRACTS.uniswapSuite.UniswapV3Factory = factory.address
  console.log(`Factory deployed to ${factory.address}`)

  const SwapRouterContract = new ethers.ContractFactory(artifacts.SwapRouter.abi, artifacts.SwapRouter.bytecode, owner);
  const swapRouter = await SwapRouterContract.deploy(await factory.address, await WETH);
  await swapRouter.deployed()

  console.log(`SwapRouter deployed to ${swapRouter.address}`)
  CONTRACTS.uniswapSuite.SwapRouter = swapRouter.address

  const NFTDescriptor = new ethers.ContractFactory(artifacts.NFTDescriptor.abi, artifacts.NFTDescriptor.bytecode, owner);
  const nftDescriptor = await NFTDescriptor.deploy();
  await nftDescriptor.deployed()

  console.log(`NFTDescriptor deployed to ${nftDescriptor.address}`)
  CONTRACTS.uniswapSuite.NFTDescriptor = nftDescriptor.address

  const linkedBytecode = linkLibraries(
    {
      bytecode: artifacts.NonfungibleTokenPositionDescriptor.bytecode,
      linkReferences: {
        "NFTDescriptor.sol": {
          NFTDescriptor: [
            {
              length: 20,
              start: 1681,
            },
          ],
        },
      },
    },
    {
      NFTDescriptor: nftDescriptor.address,
    }
  );

  const NonfungibleTokenPositionDescriptor = new ethers.ContractFactory(artifacts.NonfungibleTokenPositionDescriptor.abi, linkedBytecode, owner);
  const nativeCurrencyLabelBytes = ethers.utils.formatBytes32String('WETH')
  const nonfungibleTokenPositionDescriptor = await NonfungibleTokenPositionDescriptor.deploy(await WETH, nativeCurrencyLabelBytes);
  await nonfungibleTokenPositionDescriptor.deployed()

  console.log(`NonfungibleTokenPositionDescriptor deployed to ${nonfungibleTokenPositionDescriptor.address}`)
  CONTRACTS.uniswapSuite.NonfungibleTokenPositionDescriptor = nonfungibleTokenPositionDescriptor.address

  const NonfungiblePositionManager = new ethers.ContractFactory(artifacts.NonfungiblePositionManager.abi, artifacts.NonfungiblePositionManager.bytecode, owner);
  const nonfungiblePositionManager = await NonfungiblePositionManager.deploy(await factory.address, await WETH, await nonfungibleTokenPositionDescriptor.address);
  await nonfungiblePositionManager.deployed()
  
  console.log(`NonfungiblePositionManager deployed to ${nonfungiblePositionManager.address}`)
  CONTRACTS.uniswapSuite.NonfungiblePositionManager = nonfungiblePositionManager.address

  CONTRACTS.pools = {}
  saveContractJSONFile(CONTRACTS)
}

const addUSDTxUSDCPool = async (owner: Signer, positionManager: Contract, factory: Contract) => {
  const pool = await addPool(owner, positionManager, factory, {
    token0: new Contract(CONTRACTS.token.USDT, artifacts.ERC20.abi, provider as any),
    token1: new Contract(CONTRACTS.token.USDC, artifacts.ERC20.abi, provider as any),
    fee: 3000, // 0.3%
    price: BigNumber.from(encodeSqrtRatioX96(1, 1).toString())
  })
  
  const poolData = await getPoolData(pool)

  const list = await ethers.getSigners() as any
  const choice = [50_000, 100_000, 150_000, 200_000] 

  for (let i = 1; i < 10; i++) {
    const c = choice[Math.floor(Math.random() * choice.length)]
    const tickLower = nearestUsableTick(poolData.tick, poolData.tickSpacing) - poolData.tickSpacing * Math.floor(Math.random() * 100)
    const tickUpper = nearestUsableTick(poolData.tick, poolData.tickSpacing) + poolData.tickSpacing * Math.floor(Math.random() * 100)

    await addLiquidity(pool, positionManager, {tokenAddress: CONTRACTS.token.USDT, amount: ethers.utils.parseEther(c.toString())}, {lower: tickLower, upper: tickUpper}, list[i])
  }
}

const addCTSIxUSDTPool = async (owner: Signer, positionManager: Contract, factory: Contract) => {

  const pool = await addPool(owner, positionManager, factory, {
    token0: new Contract(CONTRACTS.token.CTSI, artifacts.ERC20.abi, provider as any),
    token1: new Contract(CONTRACTS.token.USDT, artifacts.ERC20.abi, provider as any),
    fee: 3000, // 0.3%
    price: BigNumber.from(encodeSqrtRatioX96(100000000000, 250000000000).toString())
  })

  const poolData = await getPoolData(pool)

  const list = await ethers.getSigners() as any
  const choice = [30_000, 50_000] 
  for (let i = 1; i < 10; i++) {
    const c = choice[Math.floor(Math.random() * choice.length)]
    const tickLower = nearestUsableTick(poolData.tick, poolData.tickSpacing) - poolData.tickSpacing * Math.floor(Math.random() * 200)
    const tickUpper = nearestUsableTick(poolData.tick, poolData.tickSpacing) + poolData.tickSpacing * Math.floor(Math.random() * 200)
    await addLiquidity(pool, positionManager, {tokenAddress: CONTRACTS.token.USDT, amount: ethers.utils.parseEther(c.toString())}, {lower: tickLower, upper: tickUpper != tickLower ? tickUpper : tickUpper + poolData.tickSpacing}, list[i])
  }
}

const addCTSIxUSDCPool = async (owner: Signer, positionManager: Contract, factory: Contract) => {

  const pool = await addPool(owner, positionManager, factory, {
    token0: new Contract(CONTRACTS.token.CTSI, artifacts.ERC20.abi, provider as any),
    token1: new Contract(CONTRACTS.token.USDC, artifacts.ERC20.abi, provider as any),
    fee: 3000, // 0.3%
    price: BigNumber.from(encodeSqrtRatioX96(100000000000, 250000000000).toString())
  })

  const poolData = await getPoolData(pool)

  const list = await ethers.getSigners() as any
  const choice = [30_000, 50_000] 
  for (let i = 1; i < 10; i++) {
    const c = choice[Math.floor(Math.random() * choice.length)]
    const tickLower = nearestUsableTick(poolData.tick, poolData.tickSpacing) - poolData.tickSpacing * Math.floor(Math.random() * 100)
    const tickUpper = nearestUsableTick(poolData.tick, poolData.tickSpacing) + poolData.tickSpacing * Math.floor(Math.random() * 100)
    await addLiquidity(pool, positionManager, {tokenAddress: CONTRACTS.token.USDC, amount: ethers.utils.parseEther(c.toString())}, {lower: tickLower, upper: tickUpper != tickLower ? tickUpper : tickUpper + poolData.tickSpacing}, list[i])
  }
}

const addINJxUSDTPool = async (owner: Signer, positionManager: Contract, factory: Contract) => {

  const pool = await addPool(owner, positionManager, factory, {
    token0: new Contract(CONTRACTS.token.INJ, artifacts.ERC20.abi, provider as any),
    token1: new Contract(CONTRACTS.token.USDT, artifacts.ERC20.abi, provider as any),
    fee: 3000, // 0.3%
    price: BigNumber.from(encodeSqrtRatioX96(400, 10).toString())
  })

  const poolData = await getPoolData(pool)

  const list = await ethers.getSigners() as any
  const choice = [30_000, 50_000] 
  for (let i = 1; i < 10; i++) {
    const c = choice[Math.floor(Math.random() * choice.length)]
    const tickLower = nearestUsableTick(poolData.tick, poolData.tickSpacing) - poolData.tickSpacing * Math.floor(Math.random() * 100)
    const tickUpper = nearestUsableTick(poolData.tick, poolData.tickSpacing) + poolData.tickSpacing * Math.floor(Math.random() * 100)
    await addLiquidity(pool, positionManager, {tokenAddress: CONTRACTS.token.USDT, amount: ethers.utils.parseEther(c.toString())}, {lower: tickLower, upper: tickUpper != tickLower ? tickUpper : tickUpper + poolData.tickSpacing}, list[i])
  }
}

const addINJxUSDCPool = async (owner: Signer, positionManager: Contract, factory: Contract) => {

  const pool = await addPool(owner, positionManager, factory, {
    token0: new Contract(CONTRACTS.token.INJ, artifacts.ERC20.abi, provider as any),
    token1: new Contract(CONTRACTS.token.USDC, artifacts.ERC20.abi, provider as any),
    fee: 3000, // 0.3%
    price: BigNumber.from(encodeSqrtRatioX96(400, 10).toString())
  })

  const poolData = await getPoolData(pool)

  const list = await ethers.getSigners() as any
  const choice = [30_000, 50_000] 
  for (let i = 1; i < 10; i++) {
    const c = choice[Math.floor(Math.random() * choice.length)]
    const tickLower = nearestUsableTick(poolData.tick, poolData.tickSpacing) - poolData.tickSpacing * Math.floor(Math.random() * 100)
    const tickUpper = nearestUsableTick(poolData.tick, poolData.tickSpacing) + poolData.tickSpacing * Math.floor(Math.random() * 100)
    await addLiquidity(pool, positionManager, {tokenAddress: CONTRACTS.token.USDC, amount: ethers.utils.parseEther(c.toString())}, {lower: tickLower, upper: tickUpper != tickLower ? tickUpper : tickUpper + poolData.tickSpacing}, list[i])
  }
}


const deployPools = async () => {

  console.log('\n\nPOOLS:\n')

  const nonfungiblePositionManager = new Contract(
    CONTRACTS.uniswapSuite.NonfungiblePositionManager,
    artifacts.NonfungiblePositionManager.abi,
    provider as any
  )
  
  const factory = new Contract(
    CONTRACTS.uniswapSuite.UniswapV3Factory,
    artifacts.UniswapV3Factory.abi,
    provider as any
  )
  const [owner] = await ethers.getSigners() as any
    
  // await addUSDTxUSDCPool(owner, nonfungiblePositionManager, factory)
  await addCTSIxUSDTPool(owner, nonfungiblePositionManager, factory)
  // await addCTSIxUSDCPool(owner, nonfungiblePositionManager, factory)
  // await addINJxUSDTPool(owner, nonfungiblePositionManager, factory)
  // await addINJxUSDCPool(owner, nonfungiblePositionManager, factory)
  await swapToken({
    coinQuoteSymbol: 'USDT',
    coinPurchasedSymbol: 'CTSI',
    amountQuote: BigNumber.from(ethers.utils.parseEther('500000')),
    fee: 3000
  })
}

async function main() {
  await deployTokens()
  await deployUniswapSuite()
  await deployPools()
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
