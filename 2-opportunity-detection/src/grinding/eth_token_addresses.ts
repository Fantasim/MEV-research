import { ethers } from 'ethers'
import fs from 'fs'
import { TOKEN_TYPES, TTokenType, TokenModel, tokens } from '../models/token'
import { PRODUCTION, poly } from '../constant'
import { UniswapPoolModel, pools } from '../models/pool'
import yaml from 'yaml'
import _ from 'lodash'
import { handleError } from './util'
import { logger } from '../constant/log'
import * as colorette from "colorette"
import { areSymbolsEqual } from '../utils'
import { USDT_ADDRESS } from '../constant/contracts'

let isFirstRun = true

interface IAddress { 
    address: string
    type: TTokenType
}

const formatTokenList = (jsonData: any) => {
    
    //initialize with usdt
    let listTokens: IAddress[] = [{
        address: USDT_ADDRESS,
        type: 'usd_erc20'
    }]
    
    //get all token addresses and types
    //lowercase all addresses and remove duplicates
    Object.keys(jsonData).forEach((key: string) => {
        listTokens.push(...jsonData[key].map((address: string) => ({address: address.toLowerCase(), type: key})))
    })
    listTokens = _.uniqBy(listTokens, 'address')
    //check the address format and type
    const wrongAddress: string[] = []
    for (const token of listTokens) {
        if (!ethers.isAddress(token.address)){
            wrongAddress.push(token.address)
            handleError(`GRIND: invalid ethereum address: ${token.address}`, isFirstRun)
        }
        if (!TOKEN_TYPES.includes(token.type)){
            wrongAddress.push(token.address)
            handleError(`GRIND: invalid token type: ${token.type} for address: ${token.address}`, isFirstRun)
        }
    }

    return listTokens.filter((token: {address: string, type: TTokenType}) => !wrongAddress.includes(token.address))
}

const interpretListChange = (list: IAddress[]) => {
    const ret: {
        deleted: TokenModel[],
        added: IAddress[],
    } = {
        deleted: [],
        added: [],
    }

    for (const token of list){
        const c = tokens.findByAddress(token.address)
        if (!c || !c.isActive())
            ret.added.push(token)
    }

    const addresses = list.map((token: IAddress) => token.address)
    tokens.forEach((token: TokenModel) => {
        token.isActive() && !addresses.includes(token.get().address()) && ret.deleted.push(token)
    })
    return ret
}


const initTokens = async (listTokens: IAddress[]) => {

    const {added, deleted} = interpretListChange(listTokens)

    for (const token of deleted){
        await token.disable()
    }

    if (PRODUCTION && isFirstRun){
        logger.level(3).printWithPostIntro('grinder', 'pulling', 'informative', `${colorette.bold('all')} tokens data...`)
        await Promise.allSettled(tokens.filterByActive().map((token: TokenModel) => token.refresh()))
    }
    if (PRODUCTION){
        isFirstRun && logger.level(3).printWithPostIntro('grinder', 'on', 'positive', ': watching tokens')
        await tokens.watchEvents()
    }

    const countDeleted = deleted.length
    let countNew = 0
    let countReEnabled = 0

    for (const token of added){
        const { address, type } = token
        const existing = tokens.findByAddress(address)
        if (existing){
            await existing.enable()
            countReEnabled++
        } else {
            const r = await tokens.add(address, type)
            if (typeof r !== 'string') {
                logger.level(3).printWithPostIntro('grinder', `added`, 'positive', `ethereum token address: ${colorette.bold(address)}`)
                countNew++
            }
        }
    }

    if (countNew || countReEnabled || countDeleted){
        countDeleted && logger.level(3).printWithPostIntro('grinder', `deleted`, `negative`, `${colorette.bold(countDeleted)} ERC20`)
        countReEnabled && logger.level(3).printWithPostIntro('grinder', `re-enabled`, `informative`, `${colorette.bold(countReEnabled)} ERC20`)
        countNew && logger.level(3).printWithPostIntro('grinder', `added`, `positive`, `${colorette.bold(countNew)} ERC20`)
        tokens.action().store()
    } else {
        logger.print('grinder', 'no changes in ethereum token addresses...')
    }
}

const initPools = async () => {
    let countNewUniquePools = 0
    const processStart = Date.now()
    for (let i = 0; i < tokens.count(); i++) {
        const token0 = tokens.nodeAt(i) as TokenModel
        if (token0.isActive()){
            for (let j = 0; j < tokens.count(); j++) {
                const token1 = tokens.nodeAt(j) as TokenModel
                const r = await pools.add(token0, token1)
                !!r && typeof r !== 'string' && countNewUniquePools++
            }
        }
    }

    let countPoolRefreshed = 0
    await Promise.all(pools.filterCreatedBefore(processStart).filterByActive().map(async (pool: UniswapPoolModel) => {
        if (!pool.isWatching()){
            PRODUCTION && isFirstRun && await pool.refresh() && countPoolRefreshed++
        }
    }))
    countPoolRefreshed && logger.level(3).printWithPostIntro('grinder', `pulling`, `informative`, `${colorette.bold(countPoolRefreshed)} pools data`)

    await pools.watchEvents()
    isFirstRun && logger.level(3).printWithPostIntro('grinder', 'on', 'positive', ': watching pools')
    
    //log
    if (countNewUniquePools){
        pools.action().store() 
        logger.level(3).printWithPostIntro('grinder', `added`, `positive`, `${colorette.bold(countNewUniquePools)} new unique pool pairs`)
    } else {
       logger.print('grinder', 'no new unique pool pairs...')
    }
}

export const initTokensPriceTracking = () => {
    let watched: {[key: string]: boolean} = {}
    pools.forEach((pool: UniswapPoolModel) => {
        const token0 = pool.get().token0Model()
        const token1 = pool.get().token1Model()
        if (token0 && token1){
            const symb0 = token0.get().unwrappedSymbol()
            const symb1 = token1.get().unwrappedSymbol()
            if (symb0 && symb1 && !areSymbolsEqual(symb0, symb1)){
                const p = poly.addPair(symb0, symb1)
                if (typeof p !== 'string'){
                    const key = p.get().symbol0() + '-' + p.get().symbol1()
                    watched[key] = true
                }
            }
        }
    })
    isFirstRun && logger.level(3).printWithPostIntro('grinder', `monitoring`, 'informative', `${colorette.bold(Object.keys(watched).length)} price pairs`)
}

export const RunEthTokenAddressesGrind = async (filePath: string) => {
    isFirstRun && logger.level(3).printWithPostIntro('grinder', 'start', 'positive', 'ethereum token addresses...')
    !isFirstRun && logger.level(3).printWithPostIntro('grinder', 'update', 'informative', 'ethereum token addresses...')

    try {
        //read file and parse json
        let parsing: any
        try {
            parsing = yaml.parse(fs.readFileSync(filePath, 'utf8'))
        } catch(e){
            handleError(`GRIND: error parsing file: ${filePath}`, isFirstRun)
        }

        const listTokens = formatTokenList(parsing)

        await initTokens(listTokens)
        await initPools()
        await initTokensPriceTracking()

        isFirstRun = false
    } catch (e){
        handleError(e, isFirstRun)
        return
    }
}