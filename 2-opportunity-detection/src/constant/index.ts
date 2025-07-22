import { ethers } from "ethers"
import { Web3 } from 'web3';
import {PolyPrice} from 'polyprice'
import LocalStorage from "acey-node-store"
import { Controler } from "../models/controller"

//RPC configuration
export const RPC_PROVIDER = 'http://192.168.1.93:8545'
export const RPC_PROVIDER_WS = 'ws://192.168.1.93:8546'
// export const RPC_PROVIDER = 'https://mainnet.infura.io/v3/23772463b68e4ebbac33a91b5b370edd'
// export const RPC_PROVIDER_WS = 'wss://mainnet.infura.io/ws/v3/23772463b68e4ebbac33a91b5b370edd'

export const web3WS = new Web3(new Web3.providers.WebsocketProvider(RPC_PROVIDER_WS));
export const web3HTTP = new Web3(new Web3.providers.HttpProvider(RPC_PROVIDER));  

//server configuration
export const LOGS_FOLDER_PATH = './logs';
export const DB_FOLDER_PATH = './db';
export const GRINDS_FOLDER_PATH = './grinds';
export const PROGRAM_START = Date.now()
export const PRODUCTION: boolean = true 
export const ENABLE_RPC_WEBSOCKET = true
export const ENABLE_RPC_COMPETITION_CHECK = false
export const ENABLE_RPC_ACTIVITY_CHECK = PRODUCTION && false
export const ENABLE_USD_TRACKING = true //This adds a layer of protection against usdc-usdt 1:1 depagging events

//system configuration
export const RETRY_POOL_FINDING_EVERY_MS = 30 * 24 * 3600 * 1000 // 30 days
export const MINIMUM_USD_POOL_LIQUIDITY = 70_000
export const MAX_PERCENT_DIFFERENCE_USDC_USDT_BEFORE_BLACK_SWAN_WARNING = 2.5
export const MAX_ALLOWED_TIME_DIFF_BETWEEN_STABLE_PRICE_RECORD = 45 * 1000 // 45 seconds
export const getAllowedTimeDiffBetweenERC20PriceRecord = () => 45 * 1000 * 1 /* 1 should be the volatility index) */
 

export type TStableTokenRef = 'USDT' | 'USDC'
export const LIST_STABLE_TOKENS: TStableTokenRef[] = ['USDT', 'USDC']


//global variables
export const localStorage = new LocalStorage(DB_FOLDER_PATH)
export const controller = new Controler()

export const poly = new PolyPrice({
    local_storage: localStorage,
    logging: 'none',
    price_history_expiration_ms: 3600 * 1000, //1 hour
}, controller.onPriceUpdateFromPoly)

//Very generic functions
export function getEthClient() {
    const provider = new ethers.JsonRpcProvider(RPC_PROVIDER)
    return provider;
}