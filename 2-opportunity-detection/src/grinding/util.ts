import fs from 'fs'
import { logger } from '../constant/log'

export const handleError = (error: any, extreme = true) => {
    logger.print('error', error)
    extreme && process.exit(1)
}

export const grindHandler = (path: string, fn: (p: string) => void) => {
    fn(path)
    fs.watch(path, (eventType) => eventType === 'change' && fn(path))
  }