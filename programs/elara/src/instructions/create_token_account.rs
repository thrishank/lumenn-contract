use anchor_lang::prelude::*;
use anchor_spl::associated_token::{create, Create};
use anchor_spl::{
    associated_token::{get_associated_token_address, AssociatedToken},
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use light_sdk::{
    account::LightAccount,
    instruction::{account_meta::CompressedAccountMeta, ValidityProof},
};

use jupiter::program::Jupiter;

declare_program!(jupiter);

use crate::{
    error::CustomError, state::EscrowAccount, swap_cpi, LIGHT_CPI_SIGNER, PROTOCOL_VAULT_SEED,
};

use crate::{parse_jupiter_route_data, SOL_MINT};

#[derive(Accounts)]
pub struct CreateToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: This account is the owner of the new token account
    pub maker: UncheckedAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: check in program logic
    #[account(mut)]
    pub maker_token_ata: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"protocol_vault"],
        bump
    )]
    pub protocol_vault: SystemAccount<'info>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = protocol_vault,
        associated_token::token_program = token_program
    )]
    pub protocol_vault_input_mint_ata: InterfaceAccount<'info, TokenAccount>,

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
    pub taking_amount: u64,
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
        return Err(error!(CustomError::InvalidTokenAccount));
    }

    if !ctx.accounts.maker_token_ata.data_is_empty() {
        return Err(error!(CustomError::TokenAccountAlreadyExists));
    }

    let remaining = &ctx.remaining_accounts;
    let light_accounts = &remaining[0..10];
    let jupiter_accounts = &remaining[10..];

    let jup_data = parse_jupiter_route_data(&args.swap_data)?;

    if jup_data.out_amount != 2039280 {
        return Err(error!(CustomError::InvalidOutAmount));
    }

    if !jup_data.is_exact_out {
        return Err(error!(CustomError::InvalidJupInstructionData));
    }

    if jup_data.slippage_bps > 101 {
        return Err(error!(CustomError::SlippageTooHigh));
    }

    if jup_data.platform_fee_bps != 0 {
        return Err(error!(CustomError::InvalidPlatformFeeBps));
    }

    let is_making_sol = ctx.accounts.mint.key().to_string() == SOL_MINT;
    if is_making_sol {
        return Err(error!(CustomError::InvalidCreateAtaInstruction));
    }

    /*
    swap_cpi(
        &args.swap_data,
        jupiter_accounts,
        &ctx.accounts.jupiter_program,
        &ctx.accounts.protocol_vault.to_account_info(),
    )?;
    */

    light_cpi(
        &ctx,
        light_accounts,
        &args,
        jup_data.in_amount,
        args.taking_amount,
    )?;
    create_associated_token_account(&ctx)?;
    Ok(())
}

fn light_cpi<'info>(
    ctx: &Context<'_, '_, '_, 'info, CreateToken<'info>>,
    light_accounts: &[AccountInfo<'info>],
    args: &CreateTokenAccountArgs,
    amount_swapped: u64,
    taking_amount: u64,
) -> Result<()> {
    msg!("account len: {}", ctx.remaining_accounts.len());
    let escrow_account = args.escrow_account;

    let mut escrow = LightAccount::<'_, EscrowAccount>::new_mut(
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

    escrow.amount.making_amount = escrow
        .amount
        .making_amount
        .checked_sub(amount_swapped)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // NOTE: calculate the equivalent taking amount and subtract it from the state
    escrow.amount.taking_amount = escrow
        .amount
        .taking_amount
        .checked_sub(taking_amount)
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
