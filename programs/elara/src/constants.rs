use anchor_lang::prelude::*;

#[constant]
pub const PROTOCOL_VAULT_SEED: &[u8] = b"protocol_vault";

#[constant]
pub const PROTOCOL_VAULT_BUMP: u8 = 254;

#[constant]
pub const SOL_MINT: &str = "So11111111111111111111111111111111111111112";

#[constant]
pub const PROTOCOL_VAULT: Pubkey = pubkey!("HmTYE1huZakHZn9VwSR6p6mBjGFT8hJUCRC4aWuCCSnd");

#[constant]
pub const JUPITER_V6_PROGRAM_ID: Pubkey = pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

#[constant]
pub const JUPITER_EVENT_AUTHORITY: Pubkey = pubkey!("D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf");

pub const DEFAULT_PLATFORM_FEE_BPS: u8 = 5;
pub const ZERO_PLATFORM_FEE_BPS: u8 = 0;
pub const ATA_CREATION_AMOUNT: u64 = 2039280;
