#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
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
pub use instructions::*;

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

    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
        cancel_order::cancel(ctx)
    }

    pub fn fill_order(ctx: Context<FillOrder>, data: Vec<u8>) -> Result<()> {
        // if the user does not have output mint ata, swap some tokens to 0.00204 SOL using ExactOut
        fill_order::fill(ctx, data)
    }

    pub fn create_account(ctx: Context<CancelOrder>, data: Vec<u8>) -> Result<()> {
        // create a new account for the user
        // create_account::create(ctx, data)
        Ok(())
    }
}
