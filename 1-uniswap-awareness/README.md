# 1-uniswap-awareness

## Overview

This section contains my deep dive into understanding the low-level working mechanisms of the UniswapV3 protocol. The goal was to build a comprehensive foundation for MEV research by thoroughly analyzing UniswapV3's architectural design, mathematical models, and smart contract implementations.

## Approach

### Core Philosophy
The approach was fundamentally about **learning by building**. Instead of just reading documentation, I implemented a complete UniswapV3 ecosystem from scratch to understand every component's role and interaction patterns. This hands-on methodology revealed the protocol's inner workings through practical implementation challenges.

### Implementation-First Research Methodology

#### 1. **Full Stack UniswapV3 Deployment**
- **Complete Contract Suite**: Deployed the entire UniswapV3 ecosystem locally including Factory, SwapRouter, NonfungiblePositionManager, and all peripheral contracts
- **Library Linking**: Implemented proper bytecode linking for contracts like NFTDescriptor, understanding the compilation and deployment intricacies
- **WETH Integration**: Set up WETH9 contract and understood its role in the ecosystem

#### 2. **Token Economics & Pool Creation**
- **ERC20 Token Factory**: Created a factory system to deploy multiple test tokens with realistic supply distributions
- **Price Discovery Initialization**: Used `encodeSqrtRatioX96()` to set initial pool prices, understanding the mathematical relationship between price ratios and sqrt price encoding

#### 3. **Concentrated Liquidity Mechanics**
- **Tick Boundary Calculations**: Implemented `nearestUsableTick()` and tick spacing logic to understand how liquidity ranges are defined
- **Position Management**: Built complete liquidity addition workflows using the NonfungiblePositionManager
- **Dynamic Range Selection**: Created algorithms for random tick range selection to simulate real-world LP behavior patterns

#### 4. **Mathematical Implementation Deep Dive**
- **Sqrt Price Conversions**: Implemented `SQRTX96ToRatio()` and `ratioToTick()` functions to understand price encoding
- **Liquidity Calculations**: Built `calculateLiquidityForToken0/Token1()` functions using Position.fromAmount methods
- **Fee Tier Analysis**: Implemented 0.3% fee tier pools and analyzed their impact on trading dynamics

## Key Findings

### Technical Implementation Insights

#### Contract Deployment Complexity
- UniswapV3's modular architecture requires careful orchestration of multiple contracts
- Library linking (especially NFTDescriptor) requires precise bytecode manipulation
- The NonfungiblePositionManager acts as the primary user interface, abstracting complex pool interactions

#### Price Encoding Mathematics
- **SqrtPriceX96 Format**: Discovered that prices are stored as `sqrt(price) * 2^96` for mathematical efficiency
- **Tick-Price Relationship**: Each tick represents a 0.01% price change: `price = 1.0001^tick`
- **Precision Management**: Understanding how the protocol maintains precision across different token decimals and price ranges

#### Liquidity Distribution Patterns
- **Concentrated Ranges**: Implemented variable tick ranges showing how liquidity concentration affects slippage
- **Cross-Tick Gas Costs**: Observed that swaps crossing multiple ticks consume significantly more gas
- **Position Mathematics**: Learned how `Position.fromAmount0/1()` calculates optimal liquidity for given token amounts

### MEV Opportunity Identification

#### Tick-Based Attack Vectors
- **Tick Boundary Manipulation**: Large swaps that push prices across multiple tick boundaries create predictable gas spikes
- **Liquidity Concentration Attacks**: Understanding where liquidity is concentrated enables more efficient sandwich attacks
- **Range Order Sniping**: Knowledge of common tick ranges allows for targeted liquidity sniping

#### Gas Optimization Insights
- **Multicall Patterns**: The position manager uses multicall for gas-efficient batch operations
- **Approval Optimization**: Strategic token approvals can reduce transaction costs for MEV operations
- **State Reading Costs**: Understanding `slot0()` vs individual getter costs for mempool analysis

## Technical Implementation

### Code Architecture
```
1-uniswap-awareness/
├── deploy/
│   ├── add_liquidity.ts      # LP position management and tick calculations
│   ├── add_pool.ts          # Pool creation and initialization logic  
│   ├── constant.ts          # Contract artifacts and ABI definitions
│   ├── deploy.ts           # Main deployment orchestration
│   ├── deploy_uniswap.ts   # Legacy deployment script
│   ├── lib.ts              # Pool data fetching utilities
│   ├── swap_token.ts       # Trade execution implementation
│   ├── utils.ts            # Mathematical helpers and conversions
│   └── WETH9.json         # WETH contract definition
├── contracts/              # Custom ERC20 factory contracts
├── hardhat.config.ts      # Local blockchain configuration
└── deployed.json          # Contract address registry
```

### Key Implementation Components

#### 1. Pool Management System (`add_pool.ts`)
- **Factory Integration**: Uses UniswapV3Factory to create pools with specific fee tiers
- **Price Initialization**: Implements `encodeSqrtRatioX96()` for setting initial pool prices
- **Address Sorting**: Handles token0/token1 ordering based on address comparison
- **Contract Registry**: Maintains deployed pool addresses for easy reference

#### 2. Liquidity Provision Engine (`add_liquidity.ts`)
- **Tick Calculations**: Uses `nearestUsableTick()` to ensure valid liquidity ranges
- **Amount Optimization**: Implements both `calculateLiquidityForToken0/1()` strategies
- **Position Creation**: Integrates with NonfungiblePositionManager for LP NFTs
- **Multi-Signer Distribution**: Simulates realistic liquidity provider behavior across 10 different accounts

#### 3. Mathematical Utilities (`utils.ts`)
- **Price Conversions**: `ratioToTick()`, `tickToRatio()`, `SQRTX96ToRatio()` functions
- **Precision Handling**: JSBI integration for handling large number arithmetic
- **Liquidity Calculations**: Position-based liquidity computation using Uniswap SDK
- **Library Linking**: Bytecode manipulation for contract dependencies

#### 4. Trading Implementation (`swap_token.ts`)
- **Route Construction**: Uses Uniswap SDK Route and Trade classes
- **Slippage Protection**: Implements configurable slippage tolerance (10%)
- **Gas Optimization**: Fixed gas limits based on empirical testing
- **Balance Tracking**: Pre/post swap balance analysis for verification

### Real-World Simulation Environment

#### Multi-Token Ecosystem
- **4 Token Types**: CTSI, USDT, USDC, INJ with realistic supply distributions
- **Cross-Pair Trading**: Multiple pool combinations for arbitrage testing

#### Liquidity Bootstrapping
- **Randomized Ranges**: LP positions with random tick boundaries to simulate market diversity
- **Varied Amounts**: Different liquidity amounts (30k-200k) to create realistic depth distribution
- **Fee Tier Strategy**: Focus on 0.3% pools for optimal trading volume

#### Pool Initialization Prices
- **USDT/USDC**: 1:1 parity for stablecoin pair testing
- **CTSI/USDT**: 1:0.25 ratio simulating mid-cap token pricing
- **INJ/USDT**: 40:1 ratio for higher-priced token dynamics

## Research Applications

### Foundation for Advanced MEV Strategies
This implementation-based understanding provides critical insights for:

#### **Sandwich Attack Optimization**
- **Tick Boundary Prediction**: Understanding how large swaps will move across tick ranges
- **Gas Cost Modeling**: Knowing exact gas costs for different swap sizes enables profit calculation
- **Liquidity Density Analysis**: Identifying where concentrated liquidity creates optimal sandwich opportunities
- **Multi-Pool Coordination**: Understanding price impacts across different fee tiers

#### **Arbitrage Bot Development** 
- **Cross-Pool Price Discovery**: Real-time price comparison across different fee tiers and token pairs
- **Route Optimization**: Understanding when multi-hop trades are more profitable than direct swaps
- **Gas Cost Integration**: Factoring deployment-tested gas costs into profitability calculations
- **State Synchronization**: Efficient pool state reading patterns learned through implementation

#### **Flash Loan Strategy Design**
- **Pool State Manipulation**: Understanding how large positions affect subsequent trade pricing
- **Atomic Transaction Composition**: Knowledge of contract interaction patterns for complex strategies  
- **Liquidity Pool Targeting**: Identifying pools with favorable liquidity distributions for exploitation
- **MEV Bundle Optimization**: Understanding transaction ordering effects on pool states

#### **Liquidity Sniping Mechanisms**
- **Position NFT Analysis**: Understanding how position management affects available liquidity
- **Tick Range Intelligence**: Predicting where new liquidity will be added based on market conditions
- **Fee Collection Patterns**: Timing attacks around fee collection and position rebalancing
- **LP Behavior Modeling**: Understanding common liquidity provider patterns from multi-signer simulation

### Implementation-Derived Risk Models

#### **Smart Contract Risk Assessment**
- **Reentrancy Vectors**: Identified callback patterns in position management
- **Precision Loss Points**: Understanding where mathematical operations can cause rounding errors
- **Gas Limit Vulnerabilities**: Knowledge of operations that can cause transaction failures
- **State Inconsistency Risks**: Understanding how partial transaction failures affect pool states

#### **Economic Attack Vectors**
- **Price Manipulation Costs**: Understanding minimum capital requirements for meaningful price impact
- **Liquidity Bootstrapping Attacks**: Exploiting pools during initial liquidity provision phases
- **Fee Tier Arbitrage**: Persistent opportunities between 0.05%, 0.3%, and 1% fee pools
- **Cross-DEX Coordination**: Understanding how UniswapV3 price changes propagate to other AMMs
