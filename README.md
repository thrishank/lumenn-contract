# Lumenn

A frictionless limit order app on Solana that removes rent costs, enabling CEX-like UX with fully on-chain self-custody.

## The Problem with Solana Limit Orders

On Solana, placing a limit order with current DeFi applications (e.g., Jupiter, Kamino) requires users to pay network rent (typically ~0.005 SOL) to create the necessary accounts for each order. This rent is locked up until the order is filled or canceled.

This creates significant friction:

- **Poor User Experience**: New users are often confused by rent, why they have to pay it, and the process of reclaiming it.
- **Capital Inefficiency**: Placing multiple orders is expensive. For example, 10 open orders could lock up 0.05 SOL (~$9), discouraging active trading strategies.

## Our Solution: Rent-Free Limit Orders

Elara eliminates rent by fundamentally changing how orders are stored and executed. We use on-chain data compression to store order details and a single, shared vault to hold user funds.

This allows for a seamless, capital-efficient trading experience where users can set multiple orders without locking up any SOL in rent.

## Key Features

- **Zero Rent**: Place unlimited limit orders without paying rent.
- **CEX-like Experience**: Enjoy the fluid, frictionless trading experience of a centralized exchange, but fully decentralized and self-custodial.
- **Capital Efficiency**: Keep your SOL liquid instead of having it locked in rent-paying accounts.
- **Fully On-Chain**: All transactions are settled on the Solana blockchain, ensuring transparency and security.
- Fritictionless UX: Simple and intuitive interface for placing and managing limit orders.

## How It Works

1. **Initialize Order**: A user deposits tokens into the main Elara protocol vault and specifies the parameters for their limit order (e.g., "Sell 100 SOL for USDC when the price hits $200").
2. **Store Order Data**: The order instructions are stored on-chain using light protocol zk compression.
3. **Price Monitoring**: A backend matching engine continuously monitors asset prices.
4. **Execute Swap**: When an asset reaches the user's target price, the backend swaps the tokens and tokens are sent to the user, swaps powered by Jupiter.

## Technology Stack

- **Smart Contract**: Rust, Anchor Framework
- **Backend**: TypeScript, Node.js
- **Testing**: TypeScript, Mocha, Chai

