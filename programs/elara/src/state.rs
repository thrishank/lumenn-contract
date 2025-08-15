use anchor_lang::prelude::*;
use light_sdk::{LightDiscriminator, LightHasher};
// TODO: add the merkle tree that is used to derive the PDA in the state
#[derive(
    Debug, Clone, Copy, Default, AnchorDeserialize, AnchorSerialize, LightDiscriminator, LightHasher,
)]
pub struct EscrowAccount {
    #[hash]
    pub maker: Pubkey,
    pub unique_id: u64,
    pub tokens: Tokens,
    pub amount: Amount,
    pub expired_at: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub slippage_bps: u16,
    pub fee_bps: u16,
}

#[derive(
    Debug, Clone, Copy, Default, AnchorDeserialize, AnchorSerialize, LightDiscriminator, LightHasher,
)]
pub struct Tokens {
    #[hash]
    pub input_mint: Pubkey,
    #[hash]
    pub output_mint: Pubkey,
    #[hash]
    pub input_token_program: Pubkey,
    #[hash]
    pub output_token_program: Pubkey,
}

#[derive(
    Debug, Clone, Copy, Default, AnchorDeserialize, AnchorSerialize, LightDiscriminator, LightHasher,
)]
pub struct Amount {
    pub ori_making_amount: u64,
    pub ori_taking_amount: u64,
    pub making_amount: u64,
    pub taking_amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Copy)]
pub struct AccountParams {
    pub unique_id: u64,
    pub amount: Amount,
    pub slippage_bps: u16,
    pub fee_bps: u16,
    pub expired_at: i64,
    pub created_at: i64,
    pub updated_at: i64,
}
