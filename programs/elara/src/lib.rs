use anchor_lang::prelude::*;
use light_sdk::instruction::{account_meta::CompressedAccountMeta, ValidityProof};
use light_sdk::{cpi::CpiSigner, derive_light_cpi_signer};

declare_id!("4LhEEtzAhM6wEXJR2YQHPEs79UEx8e6HncmeHbqbW1w1");
declare_program!(jupiter_aggregator);

pub const LIGHT_CPI_SIGNER: CpiSigner =
    derive_light_cpi_signer!("4LhEEtzAhM6wEXJR2YQHPEs79UEx8e6HncmeHbqbW1w1");

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

pub use constants::*;
use instructions::*;

use crate::state::EscrowAccount;

#[program]
pub mod elara {

    use super::*;

    pub fn initialize_order<'info>(
        ctx: Context<'_, '_, '_, 'info, InitializeOrder<'info>>,
        order_args: InitializeOrderParams,
        light_args: LightArgs,
    ) -> Result<()> {
        initialize_order::init(ctx, order_args, light_args)
    }

    pub fn cancel_order<'info>(
        ctx: Context<'_, '_, '_, 'info, CancelOrder<'info>>,
        escrow_account: EscrowAccount,
        proof: ValidityProof,
        account_meta: CompressedAccountMeta,
    ) -> Result<()> {
        cancel_order::cancel(ctx, escrow_account, proof, account_meta)
    }

    pub fn fill_order<'info>(
        ctx: Context<'_, '_, '_, 'info, FillOrder<'info>>,
        args: FillOrderParams,
    ) -> Result<()> {
        fill_order::fill(ctx, args)
    }

    pub fn flash_fill_order(ctx: Context<FillOrder>, data: Vec<u8>) -> Result<()> {
        // flash fill
        Ok(())
    }

    pub fn create_ata<'info>(
        ctx: Context<'_, '_, '_, 'info, CreateToken<'info>>,
        args: CreateTokenAccountArgs,
    ) -> Result<()> {
        create_token_account::create_token_account(ctx, args)
    }
}
