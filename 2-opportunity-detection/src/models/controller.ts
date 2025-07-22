import minicall from 'minicall'
import moment from 'moment'
import { LIST_STABLE_TOKENS, MAX_ALLOWED_TIME_DIFF_BETWEEN_STABLE_PRICE_RECORD, MAX_PERCENT_DIFFERENCE_USDC_USDT_BEFORE_BLACK_SWAN_WARNING, MINIMUM_USD_POOL_LIQUIDITY, PROGRAM_START, TStableTokenRef, poly } from '../constant'
import { logger } from '../constant/log'
import * as colorette from "colorette"
import TradingViewAPI from 'tradingview-scraper'
import { areSymbolsEqual } from '../utils'
import { UniswapPoolModel, pools } from './pool'

export class Controler {

    private callCount = 0
    private callCountResetTime = Date.now()
    private _active = true

    private _usdTracking: {
        btcRealTimePrice: number
        ethRealTimePrice: number
        tvAPI: TradingViewAPI | null
        last_btc_price_received_at: number
        last_eth_price_received_at: number
        intervalLiveCheck: any
        restartTimeout: any
    } = {
        btcRealTimePrice: 0,
        ethRealTimePrice: 0,
        tvAPI: null,
        last_btc_price_received_at: 0,
        last_eth_price_received_at: 0,
        intervalLiveCheck: null,
        restartTimeout: null
    }

    constructor() {
        new minicall({
            time: ["00:00:00"], //Based on UTC time 
            execute: () =>{
                this.callCount = 0
                this.callCountResetTime = Date.now()
            }
        }).start()
    
        setInterval(() => {
            logger.print('performance', `Program running since ${moment(PROGRAM_START).fromNow().replace('ago', '')}`)
            logger.print('performance', `RPC call count: ${colorette.bold(this.callCount.toLocaleString())} since ${moment(this.callCountResetTime).fromNow().replace('ago', '')}`)
        }, 600_000 * 3) // 30 minutes
    }

    init = () => {
        LIST_STABLE_TOKENS.forEach(stable => {
            poly.addPair('BTC', stable)
            poly.addPair('ETH', stable)
        })
    }

    getStablePeggingInOtherStable = (stable: TStableTokenRef, stableComparison: TStableTokenRef) => {
        if (areSymbolsEqual(stable, stableComparison))
            return 1
        
        const pBTCRef = poly.findPair('BTC', stableComparison)
        const pETHRef = poly.findPair('ETH', stableComparison)
        const pBTC = poly.findPair('BTC', stable)
        const pETH = poly.findPair('BTC', stable)

        if (pBTCRef && pETHRef && pBTC && pETH){
            const btcPrice = pBTC.get().priceHistoryList().findLastPrice()
            const ethPrice = pETH.get().priceHistoryList().findLastPrice()
            const btcRefPrice = pBTCRef.get().priceHistoryList().findLastPrice()
            const ethRefPrice = pETHRef.get().priceHistoryList().findLastPrice()

            if (btcPrice && ethPrice && btcRefPrice && ethRefPrice){
                const btcPriceRecordTime = btcPrice.get().time().getTime()
                const ethPriceRecordTime = ethPrice.get().time().getTime()
                const btcRefPriceRecordTime = btcRefPrice.get().time().getTime()
                const ethRefPriceRecordTime = ethRefPrice.get().time().getTime()

                const btcDiffTime = Math.abs(btcPriceRecordTime - btcRefPriceRecordTime)
                const ethDiffTime = Math.abs(ethPriceRecordTime - ethRefPriceRecordTime)
                if (btcDiffTime < MAX_ALLOWED_TIME_DIFF_BETWEEN_STABLE_PRICE_RECORD && ethDiffTime < MAX_ALLOWED_TIME_DIFF_BETWEEN_STABLE_PRICE_RECORD){
                    const rBTC = btcPrice.get().price() / btcRefPrice.get().price()
                    const rETH = ethPrice.get().price() / ethRefPrice.get().price()

                    return (rBTC + rETH) / 2
                }
            }
        }

        (Date.now() - PROGRAM_START) > 60 * 1000 && logger.print('warning', `GetStablePeggingIn ${stableComparison} is disabled when it shouldn't !`)
        return null
    }

    getStablePeggingInUSD = (stable: TStableTokenRef) => {
        if (this.isUSDTrackingActive()){
            const pBTC = poly.findPair('BTC', stable.toUpperCase())
            const pETH = poly.findPair('ETH', stable.toUpperCase())

            if (pBTC && pETH){
                const btcPrice = pBTC.get().priceHistoryList().findLastPrice()
                const ethPrice = pETH.get().priceHistoryList().findLastPrice()

                if (btcPrice && ethPrice){
                    const btcPriceRecordTime = btcPrice.get().time().getTime()
                    const ethPriceRecordTime = ethPrice.get().time().getTime()

                    const { btcRealTimePrice, ethRealTimePrice, last_btc_price_received_at, last_eth_price_received_at } = this._usdTracking

                    const btcDiffTime = Math.abs(btcPriceRecordTime - last_btc_price_received_at)
                    const ethDiffTime = Math.abs(ethPriceRecordTime - last_eth_price_received_at)

                    if (btcDiffTime < MAX_ALLOWED_TIME_DIFF_BETWEEN_STABLE_PRICE_RECORD && ethDiffTime < MAX_ALLOWED_TIME_DIFF_BETWEEN_STABLE_PRICE_RECORD){
                        const rBTC = btcPrice.get().price() / btcRealTimePrice
                        const rETH = ethPrice.get().price() / ethRealTimePrice

                        return (rBTC + rETH) / 2
                    }
                }
            }
            (Date.now() - PROGRAM_START) > 60 * 1000 && logger.print('warning', `GetStablePeggingInUSD is disabled when it shouldn't !`)
        }
        return null
    }


    onPriceUpdateFromPoly = (symbol0: string, symbol1: string, price: number) => {

        if (!this.isUSDTrackingActive()){
            if (areSymbolsEqual(symbol0, "BTC") && areSymbolsEqual(symbol1, "USDC") || areSymbolsEqual(symbol0, "BTC") && areSymbolsEqual(symbol1, "USDT")) {
                this._usdTracking.btcRealTimePrice = price
                this._usdTracking.last_btc_price_received_at = Date.now()
            } else if (areSymbolsEqual(symbol0, "ETH") && areSymbolsEqual(symbol1, "USDC") || areSymbolsEqual(symbol0, "ETH") && areSymbolsEqual(symbol1, "USDT")) {
                this._usdTracking.ethRealTimePrice = price
                this._usdTracking.last_eth_price_received_at = Date.now()
            }
        }

        /* 
            Create a depegging system alert for USDC-USDT pair here
        */

        // if ((symbol0 === 'USDC' || symbol1 === 'USDC') &&(symbol0 === 'USDT' || symbol1 === 'USDT')) {
        //     const min = 1 - (MAX_PERCENT_DIFFERENCE_USDC_USDT_BEFORE_BLACK_SWAN_WARNING / 100)
        //     const max = 1 + (MAX_PERCENT_DIFFERENCE_USDC_USDT_BEFORE_BLACK_SWAN_WARNING / 100)
        //     if (price < min || price > max) {
        //         this.stopEverything(price)
        //     } else {
        //         this.restartEverything()
        //     }
        // }
    }


    isUSDTrackingActive = () => {
        return this._usdTracking.tvAPI !== null
    }

    stopUSDTracking = async () => {
        const { tvAPI } = this._usdTracking
        if (tvAPI){
            clearInterval(this._usdTracking.intervalLiveCheck)
            clearTimeout(this._usdTracking.restartTimeout)
            logger.level(3).printWithPostIntro('websocket', 'disabled', 'negative', 'USD tracking (protection against USD-STABLES depagging)')
            await tvAPI.cleanup()
        }
    }

    runUSDTracking = () => {
        if (!this._usdTracking.tvAPI){
            logger.level(3).printWithPostIntro('websocket', 'enabled', 'positive', 'USD tracking (protection against USD-STABLES depagging)')
            const tv = new TradingViewAPI();
            tv.setup().then(() => {
                tv.getTicker('BTCUSD').then(ticker => {
                    ticker.on('update', data => {
                        if (data.lp && data.lp !== this._usdTracking.btcRealTimePrice) {
                            this._usdTracking.btcRealTimePrice = data.lp
                            this._usdTracking.last_btc_price_received_at = Date.now()
                        }
                    });
                })
            
                tv.getTicker('ETHUSD').then(ticker => {
                    ticker.on('update', data => {
                        if (data.lp && data.lp !== this._usdTracking.ethRealTimePrice) {
                            this._usdTracking.ethRealTimePrice = data.lp
                            this._usdTracking.last_eth_price_received_at = Date.now()
                        }
                    });
                })
            });

            this._usdTracking.intervalLiveCheck = setInterval(async () => {
                const diff = Date.now() - Math.min(this._usdTracking.last_btc_price_received_at, this._usdTracking.last_eth_price_received_at)
                // If no price update in 90 seconds, restart the tracking
                if (diff > 90 * 1000) {
                    await this.stopUSDTracking()
                    this._usdTracking.restartTimeout = setTimeout(this.runUSDTracking, 5000)
                } else if (diff > 120 * 1000) {
                    logger.print('warning', `No price update with USD TRACKING in ${Math.floor(diff / 1000)} seconds.`)
                } else {
                    const diffMax = Date.now() - Math.max(this._usdTracking.last_btc_price_received_at, this._usdTracking.last_eth_price_received_at)
                    logger.print('performance', `USD Tracking : Last price update ${Math.floor(diffMax / 1000)} seconds ago. (BTC: ${colorette.bold(this._usdTracking.btcRealTimePrice.toFixed(2) + '$')} | ETH: ${colorette.bold(this._usdTracking.ethRealTimePrice.toFixed(2) + '$')})`)
                }
            }, 60 * 1000)
            this._usdTracking.tvAPI = tv
        }
    }

    disableLowLiquidityPools = () => {
        let list: string[] = []

        // pools.forEach(async (pool:UniswapPoolModel) => {
        //     const token0 = pool.get().token0Model()
        //     const token1 = pool.get().token1Model()

        //     const v0 = token0.getCheapestApproximativeValueUSD()
        //     const v1 = token1.getCheapestApproximativeValueUSD()

        //     const minValue = v0 && v1 ? MINIMUM_USD_POOL_LIQUIDITY : MINIMUM_USD_POOL_LIQUIDITY * 0.45
        //     if (!v0 && !v1){
        //         logger.print('warning', `Pool ${pool.get().key()} has no token value in USD`)
        //     }

        //     if (pool.usdValue() < minValue){
        //         await pool.disable()
        //         list.push(pool.get().key())
        //     }

        // })
        // logger.printWithPostIntro('warning', 'disabled', 'informative', list.join(', ') + ' pools (low liquidity)')

    }


    stopEverything = (USDCxUSDTPriceDetected: number) => {
        logger.printWithPostIntro('warning', 'BLACK SWAN', 'negative', `USDC-USDT price detected: ${colorette.bold(colorette.red(USDCxUSDTPriceDetected))}`)
        if (this._active){
            this._active = false
        }
    }

    restartEverything = () => {
        if (this._active) 
            return
        this._active = true
    }

    incrementCallCount = (n: number) => {
        this.callCount += n
        n % 10 === 0 && logger.print('rpc', `RPC call count: ${this.callCount}`)
    }
}