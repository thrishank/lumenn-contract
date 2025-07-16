pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("4LhEEtzAhM6wEXJR2YQHPEs79UEx8e6HncmeHbqbW1w1");
declare_program!(jupiter_aggregator);

#[program]
pub mod elara {
    use super::*;

    pub fn initialize_order(
        ctx: Context<InitializeOrder>,
        args: InitializeOrderParams,
    ) -> Result<()> {
        initialize_order::init(ctx, args)
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
