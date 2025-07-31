use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};
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

#[program]
pub mod elara {

    use super::*;

    /// This function creates a compressed escrow account using Light Protocol's state compression
    /// Transfers the maker's input tokens to the protocol vault
    pub fn initialize_order<'info>(
        ctx: Context<'_, '_, '_, 'info, InitializeOrder<'info>>,
        init_order_args: InitializeOrderParams,
        light_args: LightArgs,
    ) -> Result<()> {
        initialize_order::init(ctx, init_order_args, light_args)
    }

    // cancel an existing order by maker or cancel when expired
    // returns the tokens back to the maker and close the compressed escrow PDA aacount
    pub fn cancel_order<'info>(
        ctx: Context<'_, '_, '_, 'info, CancelOrder<'info>>,
        args: CancelOrderParams,
    ) -> Result<()> {
        cancel_order::cancel(ctx, args)
    }

    pub fn fill_order<'info>(
        ctx: Context<'_, '_, '_, 'info, FillOrder<'info>>,
        args: FillOrderParams,
    ) -> Result<()> {
        fill_order::fill(ctx, args)
    }

    pub fn partial_fill(ctx: Context<FillOrder>, data: Vec<u8>) -> Result<()> {
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

pub fn swap_cpi<'info>(
    swap_data: &[u8],
    accounts: &[AccountInfo<'info>],
    protocol_vault: &AccountInfo<'info>,
    jupiter_program: &AccountInfo<'info>,
) -> Result<()> {
    let account_metas: Vec<AccountMeta> = accounts
        .iter()
        .map(|acc| {
            let is_signer = acc.key == &protocol_vault.key();
            AccountMeta {
                pubkey: *acc.key,
                is_signer,
                is_writable: acc.is_writable,
            }
        })
        .collect();

    let signer_seeds: &[&[&[u8]]] = &[&[PROTOCOL_VAULT_SEED, &[PROTOCOL_VAULT_BUMP]]];

    invoke_signed(
        &Instruction {
            program_id: jupiter_program.key(),
            accounts: account_metas,
            data: swap_data.to_vec(),
        },
        accounts,
        signer_seeds,
    )?;

    Ok(())
}
