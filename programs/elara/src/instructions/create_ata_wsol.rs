use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use light_sdk::{
    account::LightAccount,
    instruction::{account_meta::CompressedAccountMeta, ValidityProof},
};

use crate::{error::CustomError, state::EscrowAccount, LIGHT_CPI_SIGNER, PROTOCOL_VAULT_SEED};
use crate::{parse_jupiter_route_data, SOL_MINT};

#[derive(Accounts)]
pub struct CreateTokenWsol<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: This account is the owner of the new token account
    pub maker: AccountInfo<'info>,

    pub sol_mint: InterfaceAccount<'info, Mint>,

    pub output_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = output_mint,
        associated_token::authority = maker,
        associated_token::token_program = token_program

    )]
    pub maker_token_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"protocol_vault"],
        bump
    )]
    pub protocol_vault: SystemAccount<'info>,

    #[account(
        mut,
        associated_token::mint = sol_mint,
        associated_token::authority = protocol_vault,
        associated_token::token_program = token_program
    )]
    pub protocol_vault_input_mint_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = sol_mint,
        associated_token::authority = payer,
        associated_token::token_program = token_program

    )]
    pub payer_wsol_mint_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateTokenAccountWsolArgs {
    pub swap_data: Vec<u8>,
    pub escrow_account: EscrowAccount,
    pub proof: ValidityProof,
    pub account_meta: CompressedAccountMeta,
}

pub fn create_token_account<'info>(
    ctx: Context<'_, '_, '_, 'info, CreateTokenWsol<'info>>,
    args: CreateTokenAccountWsolArgs,
) -> Result<()> {
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

    let is_making_sol = ctx.accounts.sol_mint.key().to_string() == SOL_MINT
        && args.escrow_account.tokens.input_mint.key().to_string() == SOL_MINT;

    require!(is_making_sol, CustomError::InvalidInputMint);

    transfer_sol_from_vault(&ctx, 2039280)?;

    light_cpi(&ctx, &args, jup_data.in_amount)?;
    Ok(())
}

fn light_cpi<'info>(
    ctx: &Context<'_, '_, '_, 'info, CreateTokenWsol<'info>>,
    args: &CreateTokenAccountWsolArgs,
    amount_swapped: u64,
) -> Result<()> {
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
        .checked_sub(2039280)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // NOTE: calculate the equivalent taking amount and subtract it from the state
    escrow.amount.taking_amount = escrow
        .amount
        .taking_amount
        .checked_sub(amount_swapped)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let cpi_accounts = light_sdk::cpi::CpiAccounts::new(
        ctx.accounts.payer.as_ref(),
        ctx.remaining_accounts,
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

pub fn transfer_sol_from_vault<'info>(
    ctx: &Context<'_, '_, '_, 'info, CreateTokenWsol<'info>>,
    amount: u64,
) -> Result<()> {
    let cpi_transfer_accounts = TransferChecked {
        from: ctx.accounts.protocol_vault_input_mint_ata.to_account_info(),
        to: ctx.accounts.payer_wsol_mint_ata.to_account_info(),
        authority: ctx.accounts.protocol_vault.to_account_info(),
        mint: ctx.accounts.sol_mint.to_account_info(),
    };

    let cpi_transfer = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        cpi_transfer_accounts,
    );

    let signer_seeds: &[&[&[u8]]] = &[&[PROTOCOL_VAULT_SEED, &[ctx.bumps.protocol_vault]]];

    transfer_checked(
        cpi_transfer.with_signer(signer_seeds),
        amount,
        ctx.accounts.sol_mint.decimals,
    )?;

    Ok(())
}
