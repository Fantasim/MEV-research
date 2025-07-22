import { BigNumber, Contract, Signer } from "ethers"
import { CONTRACTS, saveContractJSONFile } from "./utils"
import { artifacts } from "./constant"

export const addPool = async (
    owner: Signer,
    positionManager: Contract,
    factory: Contract,
    params: {token0: Contract, token1: Contract, fee: number, price: BigNumber }) => {
    const { fee, price } = params
      
    const token0 = params.token0
    const token1 = params.token1
  
    const res = await positionManager.connect(owner).createAndInitializePoolIfNecessary(
      token0.address,
      token1.address,
      fee,
      price,
      { gasLimit: 6000000 }
    )
  
    await res.wait(1); 
  
    const poolAddress = await factory.connect(owner).getPool(
      token0.address,
      token1.address,
      fee,
    )
    const t0Symbol = await token0.symbol()
    const t1Symbol = await token1.symbol()
    
  
    let key: string;
    if (token0.address < token1.address) {
      key = `${t0Symbol}-${t1Symbol}`
    } else {
      key = `${t1Symbol}-${t0Symbol}`
    }
  
    CONTRACTS.pools[key + '-' + fee.toString()] = poolAddress
    saveContractJSONFile(CONTRACTS)
  
    const feesPercent = (fee / 10000)
  
    console.log(`Pool created ${key} (fees: ${feesPercent}%) at contract address ${poolAddress}`)
  
    const pool = new Contract(poolAddress, artifacts.UniswapV3Pool.abi, owner)
    return pool
  }