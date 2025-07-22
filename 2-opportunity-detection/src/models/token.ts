import {  Collection, Model } from 'acey'
import ERC20 from '@openzeppelin/contracts/build/contracts/ERC20.json'
import _ from 'lodash'
import { IOptions } from 'acey/dist/src/model/option'
import { ENABLE_RPC_WEBSOCKET, LIST_STABLE_TOKENS, PRODUCTION, TStableTokenRef, controller, getAllowedTimeDiffBetweenERC20PriceRecord, getEthClient, poly, web3HTTP, web3WS } from '../constant'
import { Contract, ethers } from 'ethers'
import { MulticallProvider } from '@ethers-ext/provider-multicall'
import { USDT_ADDRESS, ZERO_ADDRESS } from '../constant/contracts'
import { UniswapPoolCollection, UniswapPoolModel, pools } from './pool'
import { EventLog } from 'web3'
import { LogsSubscription } from 'web3/lib/commonjs/eth.exports'
import { Log, logger } from '../constant/log'
import * as colorette from "colorette"
import { areAddressesEqual, areSymbolsEqual } from '../utils'


/* /!!!!\ WARNING: IF YOU ADD A NEW TOKEN TYPE, MAKE SURE TO ADD IT TO THE TOKEN_TYPES LIST AND BELOW LISTS /!!!!\ */
export type TTokenType = 'erc20' | 'usd_erc20' | 'wrapped_eth' | 'wrapped_btc'

export const TOKEN_TYPES: TTokenType[] = ['erc20', 'usd_erc20', 'wrapped_eth', 'wrapped_btc']
export const USD_STABLE_TYPE_LIST: TTokenType[] = ['usd_erc20']
export const NON_USD_STABLE_TYPE_LIST: TTokenType[] = ['erc20', 'wrapped_eth', 'wrapped_btc']
export const WRAPPED_TYPE_LIST: TTokenType[] = ['wrapped_eth', 'wrapped_btc']


interface IToken {
    name: string
    address: string
    symbol: string
    decimals: number
    totalSupply: BigInt
    type: TTokenType
    last_fetch: number
    created_at: number
    last_supply_change: number
    disabled_at: number
}

const DEFAULT_STATE: IToken = {
    name: "",
    address: "",
    symbol: "",
    decimals: 0,
    type: "erc20",
    totalSupply: BigInt(0),
    last_fetch: 0,
    last_supply_change: 0,
    created_at: Date.now(),
    disabled_at: 0
}

export class TokenModel extends Model {

    private _subscriptions: LogsSubscription[] = []

    isWatching = () => this._subscriptions.length > 0

    disable = async () => {
        if (this.isActive()){
            this.setState({ disabled_at: Date.now() })
            if (await this.stopWatchingEvents()){
                logger.printWithPostIntro('websocket', `stopped`, 'negative', `watching events from ${this.get().name()} (${this.get().symbolColored()})`)
            }
            logger.printWithPostIntro('db', `disabled`, 'negative', `token ${this.get().name()} (${this.get().symbolColored()})`)
            await Promise.all(pools.filterByToken(this).map((pool: UniswapPoolModel) => pool.disable()))
        }
    }

    enable = async () => {
        if (!this.isActive()){
            this.setState({ disabled_at: 0 })
            await this.refresh()
            if (await this.watchEvents()){
                logger.printWithPostIntro('websocket', `started`, 'positive', `watching events from ${this.get().name()} (${this.get().symbolColored()})`)
            }
            logger.printWithPostIntro('db', `enabled`, 'positive', `token ${this.get().name()} (${this.get().symbolColored()})`)
            await Promise.all(pools.filterByToken(this).map((pool: UniswapPoolModel) => pool.enable()))
        }
    }

    isActive = (): boolean => this.state.disabled_at <= 0

    private _runActiveCheckError = () => {
        if (!this.isActive())
            throw new Error(`Token ${this.get().name()} is disabled`)
    }

    constructor(state: IToken = DEFAULT_STATE, options: IOptions) {
        super(state, options)
    }

    private _updateTotalSupply = (totalSupply: bigint) => {
        const currentSupply = this.get().totalSupply()
        currentSupply > 0n && totalSupply > 0n && totalSupply !== currentSupply && this.setState({ last_supply_change: Date.now() })
        logger.print('db', `${this.get().name()} supply is now ${this.beautifulAmountStr(totalSupply, 0)}`)
        return this.setState({ totalSupply })
    }

    isStable = () => this.get().type() === 'usd_erc20'
    isWrapped = () => this.get().type().startsWith('wrapped')


    //TODO: include liquidity in the calculation
    getCheapestApproximativeValueUSD = (): number => {
        if (this.isWrapped()){
            const list = pools.filterByTokenAddresses(this.get().address(), USDT_ADDRESS)

            const p = list.orderByToken0PriceOverToken1().first() as UniswapPoolModel
            if (p){
                const isStableTokenIs1 = areAddressesEqual(p.get().token1(), USDT_ADDRESS)
                let wrappedTokenPrice = p.get().priceToken0OverToken1(p.get().token0Model(), p.get().token1Model())
                if (!isStableTokenIs1)
                    wrappedTokenPrice = 1 / wrappedTokenPrice
                return wrappedTokenPrice
            } else {
                logger.print('error', `failed to find USDT pool for wrapped token ${this.get().symbol()}`)
            }
        } else if (this.isStable()){
            return 1
        } else {
            const stables = tokens.filterByUSDStable().filterByActive().map((t: TokenModel) => t.get().address()) as string[]
            const wrapped = tokens.filterByWrapped().filterByActive().map((t: TokenModel) => t.get().address()) as string[]

            //TODO: filter the parallel pool by usd liquidity
            const parallelPool = pools.find((p:UniswapPoolModel)=>{
                if (!areAddressesEqual(p.get().token0(), this.get().address()) && !areAddressesEqual(p.get().token1(), this.get().address()))
                    return false

                const otherToken = areAddressesEqual(p.get().token0(), this.get().address()) ? p.get().token1() : p.get().token0()                
                return stables.includes(otherToken) || wrapped.includes(otherToken)
            }) as UniswapPoolModel

            if (parallelPool){
                const otherToken = areAddressesEqual(parallelPool.get().token0(), this.get().address()) ? parallelPool.get().token1Model() : parallelPool.get().token0Model()
                if (otherToken.isStable()){
                    const isStableTokenIs1 = areAddressesEqual(parallelPool.get().token1(), otherToken.get().address())
                    let tokenPrice = parallelPool.get().priceToken0OverToken1(parallelPool.get().token0Model(), parallelPool.get().token1Model())
                    if (!isStableTokenIs1)
                        tokenPrice = 1 / tokenPrice
                    return tokenPrice
                } else if (otherToken.isWrapped()){
                    const otherToken = areAddressesEqual(parallelPool.get().token0(), this.get().address()) ? parallelPool.get().token1Model() : parallelPool.get().token0Model()
                    const isWrappedTokenIs1 = areAddressesEqual(parallelPool.get().token1(), otherToken.get().address())
                    let tokenPrice = parallelPool.get().priceToken0OverToken1(parallelPool.get().token0Model(), parallelPool.get().token1Model())
                    if (!isWrappedTokenIs1)
                        tokenPrice = 1 / tokenPrice
                    return otherToken.getCheapestApproximativeValueUSD() * tokenPrice
                }
            }
        }

        return 0
    }

    beautifulAmountStr = (amount: bigint, nDecimals: number | void) => {
        const tokenDecimals = this.get().decimals();
        const formattedAmount = ethers.formatUnits(amount.toString(), tokenDecimals);        
        const [integerPart, fractionalPart] = formattedAmount.split('.');
        
        // Truncate fractional part to the appropriate number of decimal places
        const decimals = Math.floor(nDecimals || Math.floor(tokenDecimals / 3))
        const truncatedFractionalPart = fractionalPart && decimals > 0 ? fractionalPart.slice(0, decimals) : '';

        // Concatenate the integer part and truncated fractional part
        let result = colorette.bold(`${parseInt(integerPart).toLocaleString()}.${truncatedFractionalPart}`)
        
        // Append the token symbol
        result += ` ${this.get().symbolColored()}`;
    
        
        return result;
    }

    StableToStablePriceList = () => {
        if (this.get().type() !== 'usd_erc20'){
            throw new Error('StableToStablePriceList is only available for stable tokens')
        }
        const stables = tokens.filterByUSDStable()

        const prices: {[symbol: string]: number} = {}

        stables.forEach((token: TokenModel) => {
            const refStableSymbol = this.get().symbol().toUpperCase()
            const quoteStableSymbol = token.get().symbol().toUpperCase()

            if (refStableSymbol in LIST_STABLE_TOKENS && quoteStableSymbol in LIST_STABLE_TOKENS){
                const pegging = controller.getStablePeggingInOtherStable(refStableSymbol as TStableTokenRef, quoteStableSymbol as TStableTokenRef)
                if (pegging != null){
                    prices[token.get().symbol()] = pegging
                }

            } else {
                logger.print('error', `stable token ${refStableSymbol} or ${quoteStableSymbol} not found in stable list`)
            }
        })

        const usdPegg = controller.getStablePeggingInUSD(this.get().symbol().toUpperCase() as TStableTokenRef)
        if (usdPegg != null){
            prices['USD'] = usdPegg
        }
        return prices
    }

    get = () => {
        return {
            name: (): string => this.state.name,
            address: (): string => this.state.address,
            symbol: (): string => this.state.symbol,
            symbolColored: (): string => Log.randomColor(this.get().symbol()),
            type: (): TTokenType => this.state.type,
            createdAt: (): number => this.state.created_at,
            unwrappedSymbol: (): string => {
                const type = this.get().type()
                if (type.startsWith('wrapped')){
                    return type.replace('wrapped_', '')
                }
                return this.get().symbol()
            },
            decimals: (): number => this.state.decimals,
            totalSupply: (): bigint => this.state.totalSupply,
            lastFetch: (): number => this.state.last_fetch,
            lastSupplyChange: (): number => this.state.last_supply_change,
        }
    }

    contract = (type: 'single' | 'multi' = 'single') => {
        const { abi: ERC20ABI } = ERC20
        const provi = type === 'single' ? getEthClient() : new MulticallProvider(getEthClient());
        return new Contract(this.get().address(), ERC20ABI, provi)
    }

    web3Contract = (type: 'http' | 'ws') => {
        const web3 = type === 'http' ? web3HTTP : web3WS
        return new web3.eth.Contract(ERC20.abi, this.get().address())
    }

    refresh = async () => {
        this._runActiveCheckError()
        const token = this.contract()
        try {
            controller.incrementCallCount(1)
            const supply = await token.totalSupply()
            this.setState({ last_fetch: Date.now() })
            return this._updateTotalSupply(supply)
        } catch (e: any){
            logger.print('error', `fetching ${this.get().symbolColored()} token : ${e.toString()}`)
        }
    }

    getBalance = async (pool: UniswapPoolModel) => {
        this._runActiveCheckError()
        const token = this.contract()
        try {
            controller.incrementCallCount(1)
            const balance = await token.balanceOf(pool.get().address())
            return balance as bigint
        } catch (e: any){
            logger.print('error', `fetching ${this.get().symbolColored()} token balance for ${pool.get().keyColored()} : ${e.toString()}`)
        }
    }

    fetch = async () => {
        this._runActiveCheckError()
        const token = this.contract('multi')
        try {
            const requests = [token.name(), token.symbol(), token.decimals(), token.totalSupply()]
            controller.incrementCallCount(requests.length)
            const [ name, symbol, decimals, totalSupply ] = await Promise.all(requests);
            this.setState({
                name: name || '',
                symbol: symbol || '',
                decimals: Number(decimals),
                last_fetch: Date.now()
            })
            return this._updateTotalSupply(totalSupply)
        } catch (e: any){
            logger.print('error', `fetching ${this.get().symbolColored()} token : ${e.toString()}`)
        }
    }


    watchEvents = async () => {
        if (this.isWatching() || !ENABLE_RPC_WEBSOCKET || !this.isActive()) 
            return false

        const getMintingFilter = () => {
            return { filter: { from: ZERO_ADDRESS } }
        }
        const getBurningFilter = () => {
            return { filter: { to: ZERO_ADDRESS } }
        }

        const eventHandler = (e: EventLog) => {
            controller.incrementCallCount(1)
            const { from, to, value } = e.returnValues;
            handleMintOrBurn(from as string, to as string, BigInt(value as any))
        }

        const handleMintOrBurn = (from: string, to: string, value: bigint) => {
            if (!areAddressesEqual(from, ZERO_ADDRESS) && !areAddressesEqual(to, ZERO_ADDRESS))
                return
            const totalSupply = this.get().totalSupply()
            logger.print('websocket', this.beautifulAmountStr(value), from === ZERO_ADDRESS ? 'minted' : 'burned')
            this._updateTotalSupply(areAddressesEqual(from, ZERO_ADDRESS) ? totalSupply + value : totalSupply - value)
        }

        const list = await Promise.all([
            this.web3Contract('ws').events.Transfer(getMintingFilter()),
            this.web3Contract('ws').events.Transfer(getBurningFilter())
        ])

        list.forEach((p) => {
            this._subscriptions.push(p as any)
            p.on('data', eventHandler)
        })

        return true
    }
    
    stopWatchingEvents = async () => {
        if (!this.isWatching())
            return false

        await Promise.allSettled(this._subscriptions.map(async (s) => s.unsubscribe()))
        this._subscriptions = []
        return true
    }
}

export class TokenCollection extends Collection {

    private _filterByType = (...types: TTokenType[]) => this.filter((token: TokenModel) => {
        return types.includes(token.get().type())
    }) as TokenCollection

    constructor(state: any[] = [], options: IOptions){
        super(state, [TokenModel, TokenCollection], options)
    }

    findByCEXSymbol =(symbol: string) => {
        return this.find((token: TokenModel) => areSymbolsEqual(token.get().unwrappedSymbol(),symbol)) as TokenModel
    }

    filterByUSDStable = () => this._filterByType(...USD_STABLE_TYPE_LIST)
    filterByNonStable = () => this._filterByType(...NON_USD_STABLE_TYPE_LIST)
    filterByWrapped = () => this._filterByType(...WRAPPED_TYPE_LIST)

    findByUnwrappedSymbol = (symbol: string) => {
        return this.find((token: TokenModel) => areSymbolsEqual(token.get().unwrappedSymbol(), symbol)) as TokenModel
    }

    findByAddress = (address: string) => {
        return this.find((token: TokenModel) => areAddressesEqual(token.get().address(), address)) as TokenModel
    }

    filterByActive = () => this.filter((token: TokenModel) => token.isActive()) as TokenCollection

    add = async (addr: string, type: TTokenType) => {
        if (this.findByAddress(addr)) 
            return 'token already exists'

        const d: IToken = {
            name: "",
            address: addr.toLowerCase(),
            symbol: "",
            decimals: 0,
            totalSupply: BigInt(0),
            last_fetch: 0,
            last_supply_change: 0,
            created_at: Date.now(),
            type,
            disabled_at: 0
        }

        const t = new TokenModel(d, {})
        if (await t.fetch()){
            logger.print('db', `added new token ${t.get().symbolColored()}`)
            return this.push(t)
        }
        return 'error fetching token'
    }

    stopWatchingEvents = async () => {
        const listSymbols: string[] = []
        await Promise.allSettled(this.map(async (token: TokenModel) => {
            const isWatching = await token.stopWatchingEvents()
            if (isWatching)
                listSymbols.push(token.get().symbol())
        }))
        listSymbols.length && logger.printWithPostIntro('websocket', `stopped`, 'negative', `watching events from ${listSymbols.length} tokens (${listSymbols.join(', ')})`)
    }

    watchEvents = async () => {
        const listSymbols: string[] = []
        await Promise.all(this.map(async (token: TokenModel) => {
            const isWatching = await token.watchEvents()
            if (isWatching)
                listSymbols.push(token.get().symbol())
        }))
        listSymbols.length && logger.printWithPostIntro('websocket', `started`, 'positive', `watching events from ${listSymbols.length} tokens (${listSymbols.join(', ')})`)
    }
}

export const tokens = new TokenCollection([], { key: 'tokens', connected: true }) as TokenCollection