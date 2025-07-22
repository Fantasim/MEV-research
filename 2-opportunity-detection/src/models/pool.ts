import { Collection, Model } from 'acey'
import UniswapV3Pool from '@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json';
import UniswapV3Factory from '@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json';
import { ENABLE_RPC_WEBSOCKET, RETRY_POOL_FINDING_EVERY_MS, controller, getEthClient, poly, web3HTTP, web3WS } from "../constant";
import { MulticallProvider } from "@ethers-ext/provider-multicall";

import { Contract, ethers } from 'ethers';
import { IOptions } from 'acey/dist/src/model/option';
import { FeeAmount, Pool, TICK_SPACINGS } from '@uniswap/v3-sdk';
import { TokenModel, tokens } from './token';
import { USDT_ADDRESS, UniswapV3FACTORY_ADDRESS, ZERO_ADDRESS } from '../constant/contracts';
import { rpcRequestsHistory } from './rpc-req-history';
import { LogsSubscription } from 'web3/lib/commonjs/eth.exports';
import { logger } from '../constant/log';
import BigNumber from 'bignumber.js';
import JSBI from 'jsbi';
import { areAddressesEqual, convertToDecimal, sqrtPriceX96ToToken0PriceInToken1 } from '../utils';
import { detectOpportunityOnPriceChange } from '../opportunity';

interface IState {
    slot0: string
    fee: bigint
    created_at: number
    token0: string
    token1: string
    token0_reserve: bigint
    token1_reserve: bigint
    liquidity: bigint
    address: string
    last_price_change: number
    last_reserve_change: number
    last_fetch: number
    disabled_at: number
}

const DEFAULT_STATE: IState = {
    slot0: "",
    token0: "",
    token1: "",
    fee: 0n,
    token0_reserve: 0n,
    token1_reserve: 0n,
    liquidity: BigInt(0),
    address: "",
    last_price_change: 0,
    last_reserve_change: 0,
    created_at: Date.now(),
    last_fetch: 0,
    disabled_at: 0
}

export class UniswapPoolModel extends Model {

    private _subscriptions: LogsSubscription[] = []

    disable = async () => {
        if (this.isActive()){
            this.setState({ disabled_at: Date.now() })
            if (await this.stopWatchingEvents()){
                logger.printWithPostIntro('websocket', 'stopped', 'negative', `watching events from ${this.get().keyColored()} pool`)
            }
            logger.printWithPostIntro('db', 'disabled', 'negative', `pool ${this.get().keyColored()}`)
        }
    }

    isActive = () => this.state.disabled_at <= 0

    isWatching = () => this._subscriptions.length > 0

    enable = async () => {
        if (!this.isActive()) {
            this.setState({ disabled_at: 0 })
            await this.refresh()
            if (await this.watchEvents()){
                logger.printWithPostIntro('websocket', 'started', 'positive', `watching events from ${this.get().keyColored()} pool`)
            }
            logger.printWithPostIntro('db', 'enabled', 'positive', `pool ${this.get().keyColored()}`)
        }
    }

    private _runActiveCheckError = () => {
        if (!this.isActive())
            throw new Error(`Pool ${this.get().key()} is disabled`)
    }

    constructor(state: IState = DEFAULT_STATE, options: any) {
        super(state, options)
    }

    private _updateTokenReserves = (token0: TokenModel, token0Reserve: bigint, token1: TokenModel, token1Reserve: bigint) => {
        const currentToken0Reserve = this.get().token0Reserve()
        const currentToken1Reserve = this.get().token1Reserve()
        if (currentToken0Reserve > 0n && currentToken1Reserve > 0n && token0Reserve > 0n && token1Reserve > 0n){
            if (token0Reserve !== currentToken0Reserve || token1Reserve !== currentToken1Reserve){
                this.setState({
                    last_reserve_change: Date.now()
                })
            }
        }

        logger.print('db', `Pool ${this.get().keyColored()} reserves updated: ${token0.beautifulAmountStr(token0Reserve as bigint)} | ${token1.beautifulAmountStr(token1Reserve as bigint)}`)
        return this.setState({
            token0_reserve: token0Reserve,
            token1_reserve: token1Reserve
        })
    }

    private _updateSlot0 = (slot0: ISlot0, liquidity: bigint) => {
        const currentSlot0 = this.get().slot0()
        if (currentSlot0 && currentSlot0.sqrtPriceX96 !== slot0.sqrtPriceX96){
            this.setState({
                last_price_change: Date.now()
            })
        }
        logger.print('db', `Pool ${this.get().keyColored()} slot0 updated`)
        return this.setState({
            slot0: JSON.stringify(slot0),
            liquidity: liquidity
        })
    }

    web3Contract = (type: 'http' | 'ws') => {
        const { abi: V3PoolABI } = UniswapV3Pool
        const web3 = type === 'http' ? web3HTTP : web3WS
        return new web3.eth.Contract(V3PoolABI, this.get().address())
    }

    contract = (type: 'single' | 'multi' = 'single') => {
        const { abi: V3PoolABI } = UniswapV3Pool
        const provi = type === 'single' ? getEthClient() : new MulticallProvider(getEthClient());
        return new Contract(this.get().address(), V3PoolABI, provi)
    }

    private fetchSlot0 = async () => {
        this._runActiveCheckError()
        const pool = this.contract('multi')

        try {
            const requests = [pool.slot0(), pool.liquidity()]
            controller.incrementCallCount(requests.length)
            const [ slot0, liquidity ] = await Promise.all(requests);

            return this._updateSlot0(ToSlot0(slot0), liquidity)
        } catch (e: any){
            logger.print('error', `failed to refresh ${this.get().keyColored()} pool dynamic details : ${e.toString()}`)
        }
    }

    private fetchReserves = async () => {
        try {
            this._runActiveCheckError()
            const token0 = this.get().token0Model()
            const token1 = this.get().token1Model()
            controller.incrementCallCount(2)
            
            const [token0Reserve, token1Reserve ] = await Promise.all([
                token0.getBalance(this),
                token1.getBalance(this)
            ])

            return this._updateTokenReserves(token0, token0Reserve as bigint, token1, token1Reserve as bigint)
        } catch (e: any){
            logger.print('error', `failed to fetch ${this.get().keyColored()} pool reserves : ${e.toString()}`)
        }
    }

    refresh = async () => {
        this._runActiveCheckError()
        const [a1, a2] = await Promise.all([this.fetchSlot0(), this.fetchReserves()])
        return a1 || a2
    }  

    render = () => {
        return {
            slot0: this.get().slot0(),
            tickSpacing: this.get().tickSpacing(),
            last_swap: this.get().lastSwap(),
            token0: this.get().token0(),
            token1: this.get().token1(),
            liquidity: this.get().liquidity(),
            address: this.get().address()
        }
    }

    usdValue = (): number => {
        const token0 = this.get().token0Model()
        const token1 = this.get().token1Model()

        const token0USDValue = token0.getCheapestApproximativeValueUSD()
        const token1USDValue = token1.getCheapestApproximativeValueUSD()

        const token0Reserve = convertToDecimal(this.get().token0Reserve(), token0.get().decimals())
        const token1Reserve = convertToDecimal(this.get().token1Reserve(), token1.get().decimals())

        return token0Reserve * token0USDValue + token1Reserve * token1USDValue
    }

    get = () => {
        return {
            slot0:(): ISlot0 | null => this.state.slot0 ? Model.ParseStoredJSON(this.state.slot0) : null,
            tickSpacing: (): number => TICK_SPACINGS[Number(this.get().fee())],
            key: (): string => {
                const fee = Number(this.get().fee())
                if (fee == 0) 
                    return `${this.get().token0()}-${this.get().token1()}`

                const token0Symbol = this.get().token0Model().get().symbol()
                const token1Symbol = this.get().token1Model().get().symbol()
                return `${token0Symbol}-${token1Symbol}-${Number(this.get().fee())}`
            },
            keyColored: (): string => {
                const fee = Number(this.get().fee())
                if (fee == 0) 
                    return `${this.get().token0Model().get().symbolColored()}-${this.get().token1Model().get().symbolColored()}`
                
                const token0Symbol = this.get().token0Model().get().symbolColored()
                const token1Symbol = this.get().token1Model().get().symbolColored()
                return `${token0Symbol}-${token1Symbol}-${Number(this.get().fee())}`
            },
            createdAt: (): number => this.state.created_at,
            fee: (): bigint => this.state.fee,
            token0: () => this.state.token0 as string,
            token0Model: () => tokens.findByAddress(this.state.token0 as string),
            token1: () => this.state.token1 as string,
            token1Model: () => tokens.findByAddress(this.state.token1 as string),
            liquidity: () => this.state.liquidity as bigint,
            address: () => this.state.address as string,
            lastSwap: () => this.state.last_swap as number,
            lastPriceChange: () => this.state.last_price_change as number,
            token0Reserve: () => this.state.token0_reserve as bigint,
            token1Reserve: () => this.state.token1_reserve as bigint,
            priceToken0OverToken1: (token0: TokenModel, token1: TokenModel) => {
                const slot0 = this.get().slot0()
                return slot0 ? sqrtPriceX96ToToken0PriceInToken1(slot0.sqrtPriceX96, token0.get().decimals(), token1.get().decimals()) : 0
            }
        }
    }

    stopWatchingEvents = async () => {
        if (this.isWatching()){
            await Promise.allSettled(this._subscriptions.map(async (s) => s.unsubscribe()))
            this._subscriptions = []
            return true
        }
        return false
    }

    watchEvents = async () => {
        if (this.isWatching() || !ENABLE_RPC_WEBSOCKET || !this.isActive()) 
            return false

        const s = await this.web3Contract('ws').events.Swap()
        this._subscriptions.push(s as any)

        s.on('data', (event) => {
            // const { sender, recipient } = event.returnValues;
            controller.incrementCallCount(1)

            const amount0 = BigInt(event.returnValues.amount0 as bigint)
            const amount1 = BigInt(event.returnValues.amount1 as bigint)
            const sqrtPriceX96 = BigInt(event.returnValues.sqrtPriceX96 as bigint)
            const tick = BigInt(event.returnValues.tick as bigint)
            const liquidity = BigInt(event.returnValues.liquidity as bigint)

            const tokenDenominator = amount0 > 0n ? this.get().token0Model() : this.get().token1Model()
            const tokenNumerator = amount0 > 0n ? this.get().token1Model() : this.get().token0Model()
            const amountDenominator = amount0 > 0n ? amount0 : amount1
            const amountNumerator = amount0 >0n ? amount1 : amount0

            logger.print('websocket', `[SWAP] ${tokenNumerator.beautifulAmountStr(amountNumerator).replace('-', '')}  --> ${tokenDenominator.beautifulAmountStr(amountDenominator)} ($0.00) in pool ${this.get().keyColored()}`)
            
            const slot0 = this.get().slot0()
            if (slot0){
                slot0.sqrtPriceX96 = sqrtPriceX96
                slot0.tick = tick
                this._updateSlot0(slot0, liquidity)
            }

            detectOpportunityOnPriceChange(this)
        })
        return true
    }

}

interface ISlot0 {
    sqrtPriceX96: bigint;
    tick: bigint;
    observationIndex: bigint;
    observationCardinality: bigint;
    observationCardinalityNext: bigint;
    feeProtocol: bigint;
    unlocked: boolean;
}

function ToSlot0(itf: any[]): ISlot0 {
    return {
        sqrtPriceX96: itf[0],
        tick: itf[1],
        observationIndex: itf[2],
        observationCardinality: itf[3],
        observationCardinalityNext: itf[4],
        feeProtocol: itf[5],
        unlocked: itf[6],
    };
}

export class UniswapPoolCollection extends Collection {

    static uniswapFactoryContract = (type: 'single' | 'multi' = 'single') => {
        const { abi: V3FactoryABI } = UniswapV3Factory
        const provi = type === 'single' ? getEthClient() : new MulticallProvider(getEthClient());
        return new Contract(UniswapV3FACTORY_ADDRESS, V3FactoryABI, provi)
    }

    constructor(state: any[] = [], options: IOptions){
        super(state, [UniswapPoolModel, UniswapPoolCollection], options)
    }

    filterByPair = (token0: TokenModel, token1: TokenModel) => this.filter((pool: UniswapPoolModel) => {
        return (areAddressesEqual(pool.get().token0(), token0.get().address()) && areAddressesEqual(pool.get().token1(), token1.get().address())) || 
            (areAddressesEqual(pool.get().token0(), token1.get().address()) && areAddressesEqual(pool.get().token1(), token0.get().address()))
    }) as UniswapPoolCollection
    
    filterByActive = () => this.filter((pool: UniswapPoolModel) => pool.isActive()) as UniswapPoolCollection

    filterCreatedBefore = (time: number) => this.filter((pool: UniswapPoolModel) => pool.get().createdAt() < time) as UniswapPoolCollection

    filterByToken = (token: TokenModel) => this.filter((pool: UniswapPoolModel) => areAddressesEqual(pool.get().token0(), token.get().address()) || areAddressesEqual(pool.get().token1(), token.get().address())) as UniswapPoolCollection

    findByKey = (key: string) => this.find((pool: UniswapPoolModel) => pool.get().key() === key) as UniswapPoolModel

    findByAddress = (address: string) => this.find((pool: UniswapPoolModel) => areAddressesEqual(pool.get().address(), address)) as UniswapPoolModel

    filterByTokenAddresses = (address0: string,address1: string) => this.filter((pool: UniswapPoolModel) => {
        return (areAddressesEqual(pool.get().token0(), address0) && areAddressesEqual(pool.get().token1(), address1)) || areAddressesEqual(pool.get().token0(), address1) && areAddressesEqual(pool.get().token1(),address0)
    }) as UniswapPoolCollection

    add = async (token0: TokenModel, token1: TokenModel) => {
        const poolToken0 = token0.get().address() < token1.get().address() ? token0 : token1
        const poolToken1 = token0.get().address() < token1.get().address() ? token1 : token0

        const poolKey = `${poolToken0.get().symbol()}-${poolToken1.get().symbol()}`

        if (!poolToken0.isActive() || !poolToken1.isActive()){
            return `token0 or token1 is not active`
        }

        if (areAddressesEqual(poolToken0.get().address(), poolToken1.get().address()))
            return `token0 and token1 addresses are same`
        

        if (this.filterByPair(poolToken0, poolToken1).count() > 0)
            return `pool ${poolKey} already exists`
        

        const factory = UniswapPoolCollection.uniswapFactoryContract()
        const fees = [FeeAmount.LOWEST, FeeAmount.LOW, FeeAmount.MEDIUM].filter((fee)=> {
            return !rpcRequestsHistory.hasBeenCalledAfter(`${poolKey}-${Number(fee)}`, 'getPool', Date.now() - RETRY_POOL_FINDING_EVERY_MS)
        })

        try {
            if (fees.length === 0)
                return `no fees to search for ${poolKey}`

            controller.incrementCallCount(fees.length)

            //get all pools for the token pair
            const list = await Promise.all(fees.map((fee) => factory.getPool(poolToken0.get().address(), poolToken1.get().address(), fee)))

            let cnt = 0
            for (let i = 0; i < list.length; i++){
                const address = list[i].toLowerCase()
                const fee = fees[i]
                const poolFeekey = `${poolKey}-${fee}`
                rpcRequestsHistory.add(poolFeekey, 'getPool')
                
                if (!address || areAddressesEqual(address, ZERO_ADDRESS)){
                    logger.print('rpc', `no pool found for ${poolFeekey}`)
                    continue
                }

                const m = new UniswapPoolModel(Object.assign({}, DEFAULT_STATE, {created_at: Date.now(), address, fee: BigInt(fee), token0: poolToken0.get().address(), token1: poolToken1.get().address()}), {})
                if (await m.refresh()){
                    this.push(m) && cnt++
                    logger.print('db', `added pool for ${m.get().keyColored()}`)
                } else {
                    logger.print('error', `(1) failed to create pool for ${poolFeekey}`)
                }
            }

            if (cnt > 0){
                return this.action()
            }
        } catch (e: any){
            logger.print('error', `(2) failed to create pool for ${poolKey} : ${e.toString()}`)
            return 'failed to create pool'
        }
    }

    orderByToken0PriceOverToken1 = () => {
        return this.orderBy((a: UniswapPoolModel) => {
            return a.get().priceToken0OverToken1(a.get().token0Model(), a.get().token1Model())
        },'desc') as UniswapPoolCollection
    }

    stopWatchingEvents = async () => {
        const listKeys: string[] = []
        await Promise.allSettled(this.map(async (pool: UniswapPoolModel) => {
            const isWatching = await pool.stopWatchingEvents()
            if (isWatching)
                listKeys.push(pool.get().key())
        }))
        listKeys.length && logger.printWithPostIntro('websocket', `stopped`, 'negative', `watching events from ${listKeys.length} pools (${listKeys.join(', ')})`)
    }

    watchEvents = async () => {
        const listKeys: string[] = []
        await Promise.all(this.map(async (pool: UniswapPoolModel) => {
            const isWatching = await pool.watchEvents()
            if (isWatching)
            listKeys.push(pool.get().key())
        }))
        listKeys.length && logger.printWithPostIntro('websocket', `started`, 'positive', `watching events from ${listKeys.length} pools (${listKeys.join(', ')})`)
    }
}

export const pools = new UniswapPoolCollection([], { key: "uniswap_pools", connected: true })