import * as colorette from "colorette"

export type TlogLevel = 0 | 1 | 2 | 3 // 0: accurate debug, 1: much debug, 2: debug, 3: production with certainty for no errors
export type TLogArea = 'error' | 'warning' | 'rpc' | 'grinder' | 'websocket' | 'performance' | 'opportunity' | 'db' | 'success' 
const MAX_LOG_AREA_LENGTH = 11 + 2

const LOG_AREA_COLORS: {[key in TLogArea]: string} = {
    error: colorette.bold(colorette.redBright(alignWordsVertically('[ERROR]', MAX_LOG_AREA_LENGTH))),
    warning: colorette.bold(colorette.yellowBright(alignWordsVertically('[WARNING]', MAX_LOG_AREA_LENGTH))),
    rpc: colorette.bold(colorette.cyan(alignWordsVertically('[RPC]', MAX_LOG_AREA_LENGTH))),
    grinder: colorette.bold(colorette.magenta(alignWordsVertically('[GRINDER]', MAX_LOG_AREA_LENGTH))),
    websocket: colorette.bold(colorette.cyanBright(alignWordsVertically('[WEBSOCKET]', MAX_LOG_AREA_LENGTH))),
    performance: colorette.bold(colorette.blue(alignWordsVertically('[PERFORMANCE]', MAX_LOG_AREA_LENGTH))),
    opportunity: colorette.bold(colorette.bgGreenBright(alignWordsVertically('[OPPORTUNITY]', MAX_LOG_AREA_LENGTH))),
    db: colorette.bold(colorette.whiteBright(alignWordsVertically('[DB]', MAX_LOG_AREA_LENGTH))),
    success: colorette.bold(colorette.green(alignWordsVertically('[SUCCESS]', MAX_LOG_AREA_LENGTH)))
}

export const MAX_LOG_LEVEL: TlogLevel = 3
const LOG_RANK: {[key in TlogLevel]: TLogArea[]} = {
    0: ['db', 'success'],
    1: ['rpc', 'websocket'],
    2: ['grinder', 'performance'],
    3: ['warning', 'error', 'opportunity'],
}

export class Log {

    private _logLevel: TlogLevel = 2

    static randomColor = (d: string): string => {
        // Convert the string into a numeric value
        let hash = 0;
        for (let i = 0; i < d.length; i++) {
            hash = d.charCodeAt(i) + ((hash << 5) - hash);
        }

        const colors = [
            colorette.red,
            colorette.green,
            colorette.yellow,
            colorette.blue,
            colorette.magenta,
            colorette.cyan,
            colorette.black,
            colorette.redBright,
            colorette.greenBright,
            colorette.yellowBright,
            colorette.blueBright,
            colorette.magentaBright,
            colorette.cyanBright,
            colorette.whiteBright
        ]

        return colors[hash % colors.length](d)
    }

    constructor(){}

    printInFile = (type: TLogArea, ...values: any) => {
        // let intro = `[${getCurrentDateTime()}]` + ' ' + LOG_AREA_COLORS[type]
        // for (let i = 0; i < values.length; i++){
        //     intro += ' ' + values[i].toString()
        // }

        // // fs.appendFileSync(`./.logs/${type}.txt`, intro)
    }

    level = (level: TlogLevel) => {
        if (level >= this._logLevel){
              return {
                print: this._print,
                printWithPostIntro: this._printWithPostIntro
              }
        } else {
            return {
                print: (type: TLogArea, ...values: any) => {
                    this.printInFile(type, values)
                },
                printWithPostIntro: (type: TLogArea, pintro: string, pintroType: 'positive' | 'negative' | 'informative', ...values: any) => {
                    this.printInFile(type, pintro, pintroType, values)
                }
            }
        }
    }

    private typesOfCurrentLevel = () => {
        const types: TLogArea[] = []
        for (let i = this._logLevel; i < MAX_LOG_LEVEL+1; i++){
            types.push(...LOG_RANK[i])
        }
        return types
    }

    
    print = (type: TLogArea, ...values: any) => {
        this.printInFile(type, values)
        if (this.typesOfCurrentLevel().includes(type)){
            this._print(type, ...values)
        }
    }

    printWithPostIntro = (type: TLogArea, pintro: string, pintroType: 'positive' | 'negative' | 'informative', ...values: any) => {
        this.printInFile(type, pintro, pintroType, values)
        if (this.typesOfCurrentLevel().includes(type)){
            this._printWithPostIntro(type, pintro, pintroType, ...values)
        }
    }

    private _printWithPostIntro = (type: TLogArea, pintro: string, pintroType: 'positive' | 'negative' | 'informative', ...values: any) => {
        const intro = colorette.gray(`[${getCurrentDateTime()}]`) + ' ' + LOG_AREA_COLORS[type]
        const pintroColor: {
            positive: string,
            negative: string,
            informative: string
        } = {
            positive: colorette.green(pintro),
            negative: colorette.red(pintro),
            informative: colorette.blue(pintro)
        }

        console.log(intro, pintroColor[pintroType], ...values)
    }


    private _print = (type: TLogArea, ...values: any) => {
        const intro = colorette.gray(`[${getCurrentDateTime()}]`) + ' ' + LOG_AREA_COLORS[type]
        console.log(intro, ...values)
    }
}

export const logger = new Log()

function getCurrentDateTime() {
    const now = new Date();

    // Get month, day, hours, minutes, and seconds
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    // Combine the date and time components
    const formattedDateTime = `${month}/${day} ${hours}:${minutes}:${seconds}`;

    return formattedDateTime;
}

function alignWordsVertically(word: string, maxSize: number): string {
    return word + ' '.repeat(maxSize - word.length);
}
