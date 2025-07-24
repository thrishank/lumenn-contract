use anchor_lang::{
    prelude::*,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
    },
};
use anchor_spl::associated_token::{create, Create};
use anchor_spl::{
    associated_token::{get_associated_token_address, AssociatedToken},
    token_interface::{Mint, TokenInterface},
};
use light_sdk::{
    account::LightAccount,
    instruction::{account_meta::CompressedAccountMeta, ValidityProof},
};

use jupiter_aggregator::program::Jupiter;
declare_program!(jupiter_aggregator);
declare_program!(idl);

use crate::{
    error::ErrorCode,
    instructions::{ExactOutRoute, SharedAccountsExactOutRoute},
    state::EscrowAccount,
    LIGHT_CPI_SIGNER, PROTOCOL_VAULT_SEED,
};

#[derive(Accounts)]
pub struct CreateToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: This account is the owner of the new token account
    pub maker: UncheckedAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: check in program logic
    pub maker_token_ata: UncheckedAccount<'info>,

    #[account(
        seeds = [b"protocol_vault"],
        bump
    )]
    pub protocol_vault: SystemAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    // pub jupiter_program: Program<'info, Jupiter>,
    /// CHECK: This is the Jupiter program account
    pub jupiter_program: UncheckedAccount<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateTokenAccountArgs {
    pub swap_data: Vec<u8>,
    pub escrow_account: EscrowAccount,
    pub proof: ValidityProof,
    pub account_meta: CompressedAccountMeta,
}

pub fn create_token_account<'info>(
    ctx: Context<'_, '_, '_, 'info, CreateToken<'info>>,
    args: CreateTokenAccountArgs,
) -> Result<()> {
    let expected_ata =
        get_associated_token_address(&ctx.accounts.maker.key(), &ctx.accounts.mint.key());
    if ctx.accounts.maker_token_ata.key() != expected_ata {
        return Err(error!(ErrorCode::InvalidTokenAccount));
    }

    if !ctx.accounts.maker_token_ata.data_is_empty() {
        return Err(error!(ErrorCode::TokenAccountAlreadyExists));
    }

    let remaining = &ctx.remaining_accounts;
    let light_accounts = &remaining[0..10];
    let jupiter_accounts = &remaining[10..];

    let mut input_data = &args.swap_data[8..];
    let disc = args.swap_data[0];
    // FIX: add the full discriminator check
    match disc {
        208 => {
            let swap_data = ExactOutRoute::deserialize(&mut input_data)?;
            if swap_data.out_amount != 2039280 {
                return Err(error!(ErrorCode::InvalidOutAmount));
            }
            //swap_cpi(&ctx, &data, jupiter_accounts)?;
            light_cpi(&ctx, light_accounts, &args, swap_data.quoted_in_amount)?;
            create_associated_token_account(&ctx)?;
        }
        176 => {
            let swap_data = SharedAccountsExactOutRoute::deserialize(&mut input_data)?;
            if swap_data.out_amount != 2039280 {
                return Err(error!(ErrorCode::InvalidOutAmount));
            }
            // Self::swap_cpi(&ctx, &data, jupiter_accounts)?;
            light_cpi(&ctx, light_accounts, &args, swap_data.quoted_in_amount)?;
            create_associated_token_account(&ctx)?;
        }
        _ => {
            return Err(error!(ErrorCode::InvalidJupInstructionData));
        }
    }

    Ok(())
}

pub fn swap_cpi<'info>(
    ctx: &Context<'_, '_, '_, 'info, CreateToken<'info>>,
    swap_data: &[u8],
    accounts: &[AccountInfo<'info>],
) -> Result<()> {
    let account_metas: Vec<AccountMeta> = accounts
        .iter()
        .map(|acc| {
            let is_signer = acc.key == &ctx.accounts.protocol_vault.key();
            AccountMeta {
                pubkey: *acc.key,
                is_signer,
                is_writable: acc.is_writable,
            }
        })
        .collect();

    let signer_seeds: &[&[&[u8]]] = &[&[PROTOCOL_VAULT_SEED, &[ctx.bumps.protocol_vault]]];

    invoke_signed(
        &Instruction {
            program_id: ctx.accounts.jupiter_program.key(),
            accounts: account_metas,
            data: swap_data.to_vec(),
        },
        accounts,
        signer_seeds,
    )?;

    Ok(())
}

pub fn light_cpi<'info>(
    ctx: &Context<'_, '_, '_, 'info, CreateToken<'info>>,
    light_accounts: &[AccountInfo<'info>],
    args: &CreateTokenAccountArgs,
    amount_swapped: u64,
) -> Result<()> {
    let escrow_account = args.escrow_account;

    let escrow = LightAccount::<'_, EscrowAccount>::new_mut(
        &crate::ID,
        &args.account_meta,
        EscrowAccount {
            maker: escrow_account.maker,
            unique_id: escrow_account.unique_id,
            tokens: escrow_account.tokens,
            amount: escrow_account.amount,
            slippage_bps: escrow_account.slippage_bps,
            fee_bps: escrow_account.fee_bps,
            expired_at: escrow_account.expired_at,
            created_at: escrow_account.created_at,
            updated_at: escrow_account.updated_at,
        },
    )
    .map_err(ProgramError::from)?;

    escrow
        .amount
        .making_amount
        .checked_sub(amount_swapped)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let cpi_accounts = light_sdk::cpi::CpiAccounts::new(
        ctx.accounts.payer.as_ref(),
        light_accounts,
        LIGHT_CPI_SIGNER,
    );

    let cpi_inputs = light_sdk::cpi::CpiInputs::new(
        args.proof,
        vec![escrow.to_account_info().map_err(ProgramError::from)?],
    );

    cpi_inputs
        .invoke_light_system_program(cpi_accounts)
        .map_err(ProgramError::from)?;

    Ok(())
}

pub fn create_associated_token_account<'info>(
    ctx: &Context<'_, '_, '_, 'info, CreateToken<'info>>,
) -> Result<()> {
    let cpi_accounts = Create {
        payer: ctx.accounts.protocol_vault.to_account_info(),
        associated_token: ctx.accounts.maker_token_ata.to_account_info(),
        authority: ctx.accounts.maker.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
    };

    let cpi_program = ctx.accounts.associated_token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

    let signer_seeds: &[&[&[u8]]] = &[&[PROTOCOL_VAULT_SEED, &[ctx.bumps.protocol_vault]]];

    create(cpi_ctx.with_signer(signer_seeds))?;

    Ok(())
}
