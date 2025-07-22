
import { config } from 'acey'
import { TokenModel, tokens } from "./src/models/token"
import { ENABLE_RPC_WEBSOCKET, ENABLE_USD_TRACKING, PRODUCTION, controller, poly, web3HTTP, web3WS } from './src/constant'
import { UniswapPoolModel, pools } from './src/models/pool'
import { rpcRequestsHistory } from './src/models/rpc-req-history'
import { localStorage } from './src/constant'
import { startGrinding } from './src/grinding'
import { NewHeadsSubscription } from 'web3/lib/commonjs/eth.exports'
import { competitionCheck, passRPCStatusCheck } from './src/performance'
import { logger } from './src/constant/log'
import TradingViewAPI from 'tradingview-scraper'

let speedTestSubscriptions: NewHeadsSubscription[] | null = []

const init = async () => { 
    config.setStoreEngine(localStorage);
    await config.done()
    controller.init()
    poly.enableCPUOptimization()
    process.on('SIGINT', handleInterrupt);
    speedTestSubscriptions = await competitionCheck()
    if (ENABLE_USD_TRACKING){
        controller.runUSDTracking()
    } else {
        logger.level(3).print('warning', 'USD tracking is disabled')
    }
    await controller.disableLowLiquidityPools()
    await poly.run(7_000, 5)
}

const handleInterrupt = async () => {
    logger.print('warning', 'Program interrupted. Running cleanup code...');
    // Add your cleanup code here

    await tokens.stopWatchingEvents()
    await tokens.action().store()
    logger.level(3).printWithPostIntro('db', 'saved', 'positive', 'tokens data')
    await pools.stopWatchingEvents()
    await pools.action().store()
    logger.level(3).printWithPostIntro('db', 'saved', 'positive', 'pools data')
    rpcRequestsHistory.action().store()
    logger.level(3).printWithPostIntro('db', 'saved', 'positive', 'RPC Requests History data')
    await poly.updateDataInJSON()
    logger.level(3).printWithPostIntro('db', 'saved', 'positive', 'Polyprice data')

    await web3WS.subscriptionManager.unsubscribe()
    logger.level(3).printWithPostIntro('websocket', 'unsubscribed', 'positive', 'RPC WebSockets')

    if (speedTestSubscriptions && speedTestSubscriptions.length > 0){
        await Promise.all(speedTestSubscriptions.map(s => s.unsubscribe()))
        logger.level(3).printWithPostIntro('websocket', 'unsubscribed', 'positive', 'RPC WebSocket speed test')
    }

    await controller.stopUSDTracking()

    // For example, closing connections, saving data, etc.
    logger.level(3).print('success', 'Cleanup complete. Exiting.');
    process.exit(0); // Exit the program
};

const main = async () => {
    logger.level(3).printWithPostIntro('performance', PRODUCTION ? 'production' : 'developement', PRODUCTION ? 'negative' : 'positive', `mode...`)
    logger.level(3).printWithPostIntro('websocket', ENABLE_RPC_WEBSOCKET ? 'enabled' : 'disabled', ENABLE_RPC_WEBSOCKET ? 'positive' : 'negative', `RPC WebSocket...`)
        
    startGrinding()

}

passRPCStatusCheck().then(init).then(main)





    // const tickSpacing = Number(pool.get().tickSpacing())
    // const minWord = tickToWord(-100, tickSpacing)
    // const maxWord = tickToWord(100, tickSpacing)

    // let calls: any[] = []
    // let wordPosIndices: number[] = []
    // for (let i = minWord; i <= maxWord; i++) {
    //   wordPosIndices.push(i)
    //   calls.push(pool.contractMulticaller().tickBitmap(i))
    // }

    // const result = await Promise.all(calls)
    // const tickIndices: number[] = []

    // for (let j = 0; j < wordPosIndices.length; j++) {
    //     const ind = wordPosIndices[j]
    //     const bitmap = result[j] as bigint
    
    //     if (bitmap !== 0n) {
    //       for (let i = 0; i < 256; i++) {
    //         const bit = 1n
    //         const initialized = (bitmap & (bit << BigInt(i))) !== 0n
    //         if (initialized) {
    //           const tickIndex = (ind * 256 + i) * tickSpacing
    //           tickIndices.push(tickIndex)
    //         }
    //       }
    //     }
    // }
    // console.log(tickIndices)



