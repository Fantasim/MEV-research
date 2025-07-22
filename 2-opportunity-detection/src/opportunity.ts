import { Pair } from "polyprice";
import { poly } from "./constant";
import { TokenCollection, TokenModel, tokens } from "./models/token";
import { areAddressesEqual, areSymbolsEqual } from "./utils";
import { UniswapPoolCollection, UniswapPoolModel, pools } from "./models/pool";
import _ from 'lodash'
import fs from 'fs'
import { logger } from "./constant/log";

const MINIMUM_USD_PROFIT = 5

const getPoolPricesForRelatedTokenRecursive = (poolList: UniswapPoolCollection, token: string, pickedPools: {[address: string]: boolean}): {[address: string]: boolean} => {
    poolList.forEach((pool: UniswapPoolModel) => {
        if (pool.get().token0() === token || pool.get().token1() === token){
            const address = pool.get().address()
            if (!pickedPools[address]){
                pickedPools[address] = true
                const otherToken = pool.get().token0() === token ? pool.get().token1() : pool.get().token0()
                pickedPools = getPoolPricesForRelatedTokenRecursive(poolList, otherToken, pickedPools)
            }
        }
    })

    return pickedPools
}


const findArbitrageOpportunities = (relatedPools: UniswapPoolCollection) => {
    const opportunities: Array<{
        path: string[],
        returnRatio: number
    }> = [];

    // Convertir l'objet relatedPools en une structure de graphe plus exploitable
    const graph: { [token: string]: { [token: string]: number } } = {};

    relatedPools.forEach((pool: UniswapPoolModel) => {
        const token0 = pool.get().token0()
        const token1 = pool.get().token1()

        if (!graph[token0]) graph[token0] = {};
        if (!graph[token1]) graph[token1] = {};

        const token0M = pool.get().token0Model()
        const token1M = pool.get().token1Model()

        graph[token0][token1] = pool.get().priceToken0OverToken1(token0M, token1M)
        graph[token1][token0] = 1 / graph[token0][token1];
    });

    // DFS pour trouver des cycles bénéficiaires
    const findCycles = (start: string, current: string, visited: string[], rate: number) => {
        if (visited.includes(current) && current === start) {
            if (rate > 1) {
                opportunities.push({
                    path: [...visited, current],
                    returnRatio: rate
                });
            }
            return;
        }

        if (visited.includes(current)) {
            return;
        }

        for (const [nextToken, nextRate] of Object.entries(graph[current])) {
            findCycles(start, nextToken, [...visited, current], rate * nextRate);
        }
    };

    for (const token of Object.keys(graph)) {
        findCycles(token, token, [], 1);
    }

    return opportunities.filter((v, i, a) => a.findIndex(t => (t.path.join('') === v.path.join(''))) === i); // Filtrer les doublons
};


let countVoid = 0
let countOpportunity = 0

export const detectOpportunityOnPriceChange = (pool: UniswapPoolModel) => {
    const tokens: TokenModel[] = []
    const token0 = pool.get().token0Model()
    const token1 = pool.get().token1Model()

    if (!token0.isStable()){
        tokens.push(token0)
    }
    if (!token1.isStable()){
        tokens.push(token1)
    }

    for (const token of tokens){
        const relatedPools = getPoolPricesForRelatedTokenRecursive(pools.filterByActive(), token.get().address(), {})
        const pickedPools = pools.filter((p: UniswapPoolModel) => relatedPools[p.get().address()]) as UniswapPoolCollection
        const opportunities = findArbitrageOpportunities(pickedPools)

        const tokenUSDValue = token.getCheapestApproximativeValueUSD()

        let found = false
        opportunities.forEach((opportunity) => {
            const profit = (opportunity.returnRatio - 1) * tokenUSDValue
            if (profit >= MINIMUM_USD_PROFIT){
                logger.print('opportunity', `Detection for ${token.get().symbol()} with a profit of ${(opportunity.returnRatio * tokenUSDValue).toFixed(2)}$`)
                fs.writeFileSync(`./.opportunities/${Date.now()}-${pool.get().key()}.txt`, JSON.stringify(opportunities, null, 2))
                found = true
            }
        })
        if (!found){
            countVoid++
        } else {
            countOpportunity++
        }
    }

    countVoid % 20 === 0 && logger.print('performance', `ratio opportunity ratio per swap is: ${(countOpportunity / (countVoid + countOpportunity)).toFixed(3)} | void: ${countVoid} | found: ${countOpportunity}`)
}