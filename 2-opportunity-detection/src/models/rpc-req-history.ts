import  { Collection, Model } from 'acey'
import { IOptions } from 'acey/dist/src/model/option'

type TRPCMethod = `getPool`

interface IRPCRequest {
    time: number
    key: string
    method: TRPCMethod | null
}

const DEFAULT_STATE = {
    time: 0,
    key: '',
    method: null
}

export class RPCRequestModel extends Model {
    constructor(state: IRPCRequest = DEFAULT_STATE, options: IOptions) {
        super(state, options)
    }

    isOverAMonthAgo = () => {
        return this.get().time() < Date.now() - 30 * 24 * 60 * 60 * 1000
    }
    

    get = () => {
        return {
            time: (): number => this.state.time,
            key: (): string => this.state.key,
            method: (): TRPCMethod => this.state.method
        }
    }
}

export class RPCRequestCollection extends Collection {
    
    constructor(state: IRPCRequest[] = [], options: IOptions) {
        super(state, [RPCRequestModel, RPCRequestCollection],  options)
    }

    hasBeenCalledAfter = (key: string, method: TRPCMethod, afterTime: number) => {
        const m = this.findLastByKeyAndMethod(key, method)
        return m && m.get().time() > afterTime
    }


    findLastByKeyAndMethod = (key: string, method: TRPCMethod) => {
        return this.find((rpcRequest: RPCRequestModel) => rpcRequest.get().key() === key && rpcRequest.get().method() === method) as RPCRequestModel
    }

    add = (key: string, method: TRPCMethod) => {
        return this.prepend([{ time: Date.now(), key, method }])
    }
}

export const rpcRequestsHistory = new RPCRequestCollection([], { key: 'rpc_requests_history', connected: true })
