# Notes

## Fetching orders from the maker address

```typescript
await rpc.getCompressedAccountsByOwner(PROGRAM_ID, {
  filters: [
    {
      memcmp: {
        offset: 0,
        encoding: "base58",
        bytes: new PublicKey("maker address").toBase58(),
      },
    },
  ],
});
```

## Listening to the PROGRAM_ID logs

```rust

use solana_client::{
    rpc_client::RpcClient,
    rpc_config::{RpcTransactionLogsConfig, RpcTransactionLogsFilter},
};
use std::str::FromStr;

use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::Keypair,
    signer::Signer,
    transaction::Transaction,
};

use base64::{engine::general_purpose, Engine as _};
use borsh::{BorshDeserialize, BorshSerialize};
use solana_client::pubsub_client::PubsubClient;

#[derive(Debug, BorshDeserialize)]
pub struct OrderInitialized {
    pub escrow_address: Pubkey,
    pub maker: Pubkey,
    pub unique_id: u64,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub input_mint_decimals: u8,
    pub output_mint_decimals: u8,
    pub making_amount: u64,
    pub taking_amount: u64,
    pub slippage_bps: u16,
    pub expired_at: i64,
}

fn main() {
    let ws_url = "wss://devnet.helius-rpc.com/?api-key=c991f045-ba1f-4d71-b872-0ef87e7f039d";
    let program_id = Pubkey::from_str("4LhEEtzAhM6wEXJR2YQHPEs79UEx8e6HncmeHbqbW1w1").unwrap();

    println!("Connecting to WebSocket: {}", ws_url);

    let (mut client, receiver) = PubsubClient::logs_subscribe(
        ws_url,
        RpcTransactionLogsFilter::Mentions(vec![program_id.to_string()]),
        RpcTransactionLogsConfig {
            commitment: Some(solana_sdk::commitment_config::CommitmentConfig::confirmed()),
        },
    )
    .expect("Failed to subscribe to logs");

    println!("Subscribed to logs for program {}", program_id);

    // TODO: need to validate this logs.

    for message in receiver {
        for log in message.value.logs {
            if let Some(data) = log.strip_prefix("Program data: ") {
                match decode_event(data) {
                    Ok(event) => println!("Decoded event: {:?}", event),
                    Err(e) => eprintln!("Failed to decode event: {:?}", e),
                }
            }
        }
    }

    const ORDER_INITIALIZED_DISCRIMINATOR: [u8; 8] = [180, 118, 44, 249, 166, 25, 40, 81];
    fn decode_event(data: &str) -> Result<OrderInitialized, Box<dyn std::error::Error>> {
        let decoded = general_purpose::STANDARD.decode(data)?;
        if decoded.len() < 8 {
            return Err("Data too short".into());
        }

        if decoded[..8] != ORDER_INITIALIZED_DISCRIMINATOR {
            return Err("Discriminator mismatch".into());
        }

        // Skip first 8 bytes (Anchor event discriminator)
        let event_bytes = &decoded[8..];
        let event = OrderInitialized::try_from_slice(event_bytes)?;
        Ok(event)
    }
    // connection closes automatically when client goes out of scope
}
```
