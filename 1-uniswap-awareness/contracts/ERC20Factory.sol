// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC20Token} from "./ERC20.sol";

contract ERC20Factory {

    event TokenCreated(address indexed tokenAddress, address indexed owner);
    mapping(string => address) public tokens;

    function createToken(string memory name, string memory symbol, uint256 initialSupply) public {
        require(tokens[symbol] == address(0), "Token already exists");
        ERC20Token newToken = new ERC20Token(name, symbol, initialSupply, msg.sender);
        tokens[symbol] = address(newToken);
        emit TokenCreated(address(newToken), msg.sender);
    }
    
    function getTokenAddress(string memory symbol) public view returns (address) {
        return tokens[symbol];
    }
}
