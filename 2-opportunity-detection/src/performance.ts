import Web3 from "web3"
import { ENABLE_RPC_ACTIVITY_CHECK, ENABLE_RPC_COMPETITION_CHECK, ENABLE_RPC_WEBSOCKET, web3HTTP, web3WS } from "./constant"
import { quitProgram } from "./utils"
import { logger } from "./constant/log"
import * as colorette from "colorette"

export const passRPCStatusCheck = async () => {
    if (!ENABLE_RPC_ACTIVITY_CHECK)
        return null

    logger.level(3).print('rpc', 'Checking RPC status...')
    const status = await web3HTTP.eth.isSyncing()
    if (status !== false) {
        logger.level(3).print('rpc', 'Waiting for RPC to sync...')
        await new Promise(resolve => setTimeout(resolve, 5000))
        return passRPCStatusCheck()
    }
    logger.level(3).print('success', 'RPC is synced ✅')

    if (ENABLE_RPC_WEBSOCKET) {
        let pass = false
        let done = false
        try {
            logger.level(3).print('websocket', 'Checking RPC status...')
            const s = await web3WS.eth.subscribe('newBlockHeaders')
            s.on('data', async (d) => {
                pass = true
                done = true
                await s.unsubscribe()
            })
            s.on('error', async (e) => {
                done = true
                console.error(e)
            })
            s.on('connected', () => {
                console.log('connected')
            })

            let i = 0;
            while (!done) {
                await new Promise(resolve => setTimeout(resolve, 500))
                if (done)
                    break
                if (i % 10 === 0){
                    logger.level(3).print('rpc', 'Waiting for next block notification...')
                }
                i++
            }
            if (!pass){
                logger.print('error', 'RPC WebSocket is not working.')
                throw new Error('RPC WebSocket is not working')
            } else {
                logger.level(3).print('success', 'RPC WebSocket is working ✅')
            }
        } catch (e) {
            logger.print('error', 'RPC WebSocket is not working.')
            quitProgram()
        }
    }
}

export const competitionCheck = async () => {
    if (!ENABLE_RPC_COMPETITION_CHECK)
        return null

    const InfuraHTTP = new Web3(new Web3.providers.WebsocketProvider('wss://mainnet.infura.io/ws/v3/23772463b68e4ebbac33a91b5b370edd'));
    const sInfu = InfuraHTTP.eth.subscribe('newBlockHeaders')
    const sMine = web3WS.eth.subscribe('newBlockHeaders')

    const [ infura, mine ] = await Promise.all([sInfu, sMine])

    let infuraBlock = 0
    let mineBlock = 0
    let infuraTime = 0
    let mineTime = 0

    const logResult = () => {
        if (infuraBlock === 0 || mineBlock === 0){
            return
        }
        if (infuraBlock === mineBlock){
            if (infuraTime < mineTime){
                logger.print('performance', `Infura is faster by ${colorette.bold(mineTime - infuraTime)}ms`)
            } else {
                logger.print('performance', `My RPC is faster by ${colorette.bold(infuraTime - mineTime)}ms`)
            }
        } else if (mineBlock > infuraBlock){
            logger.print('performance', `My RPC is ahead by ${colorette.bold(mineBlock - infuraBlock)} blocks`)
        } else {
            logger.print('performance', `Infura is ahead by ${colorette.bold(infuraBlock - mineBlock)} blocks`)
        }
    }

    infura.on('data', (d) => {
        if (d.number){
            infuraBlock = Number(d.number)
            infuraTime = Date.now()
            logResult()
        }
    })
    mine.on('data', (d) => {
        if (d.number){
            mineBlock = Number(d.number)
            mineTime = Date.now()
            logResult()
        }
    })

    return [infura, mine]
}
