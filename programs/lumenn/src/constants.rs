use anchor_lang::prelude::*;

#[constant]
pub const PROTOCOL_VAULT_SEED: &[u8] = b"protocol_vault";

#[constant]
pub const PROTOCOL_VAULT_BUMP: u8 = 255;

#[constant]
pub const TOKEN_ACCOUNT_SIZE: u8 = 165;

#[constant]
pub const SOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");

#[constant]
pub const PROTOCOL_VAULT: Pubkey = pubkey!("FFbzGFqJYhxRPTsuAJ8jjjXUTiMhAqZoGRj9x8ZCN6T7");

#[constant]
pub const FEE_ACCOUNT: Pubkey = pubkey!("feeSsye1xpD4zaxVh19n92abi3ZyWngAD47Z3ygPGPA");

pub const JUPITER_V6_PROGRAM_ID: Pubkey = pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
pub const JUPITER_EVENT_AUTHORITY: Pubkey = pubkey!("D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf");
