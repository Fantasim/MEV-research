import { GRINDS_FOLDER_PATH } from '../constant'
import { RunEthTokenAddressesGrind } from './eth_token_addresses'
import { grindHandler } from './util'

export const startGrinding = () => {
    grindHandler(`${GRINDS_FOLDER_PATH}/eth_token_addresses.yaml`, RunEthTokenAddressesGrind)
}