use std::str::FromStr;

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use light_sdk::{
    account::LightAccount,
    address::v1::derive_address,
    instruction::{account_meta::CompressedAccountMeta, PackedStateTreeInfo, ValidityProof},
};

use crate::{
    error::CustomError,
    parse_jupiter_route_data,
    state::{AccountParams, EscrowAccount, Tokens},
    swap_cpi,
    utils::{
        expected_accounts, validate_jupiter_accounts, validate_light_accounts, LightAccountSet,
    },
    PROTOCOL_VAULT_SEED, SOL_MINT,
};

use jupiter::{program::Jupiter, types::RoutePlanStep};

declare_program!(jupiter);

#[derive(Accounts)]
pub struct FillOrder<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Light CPI Checks
    #[account(mut)]
    pub maker: UncheckedAccount<'info>,

    pub input_mint: InterfaceAccount<'info, Mint>,

    pub output_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = output_mint,
        associated_token::authority = maker,
        associated_token::token_program = output_token_program
    )]
    pub maker_output_mint_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"protocol_vault"],
        bump
    )]
    pub protocol_vault: SystemAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = output_mint,
        associated_token::authority = protocol_vault,
        associated_token::token_program = output_token_program
    )]
    pub protocol_vault_output_mint_ata: InterfaceAccount<'info, TokenAccount>,

    pub input_token_program: Interface<'info, TokenInterface>,
    pub output_token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub jupiter_program: Program<'info, Jupiter>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct FillOrderParams {
    pub swap_data: Vec<u8>,
    pub escrow_account: AccountParams,
    pub proof: ValidityProof,
    pub tree_info: PackedStateTreeInfo,
    pub output_state_tree_index: u8,
    pub fill_type: FillType,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum FillType {
    Full,
    Partial,
}

pub fn fill<'info>(
    ctx: Context<'_, '_, '_, 'info, FillOrder<'info>>,
    args: FillOrderParams,
) -> Result<()> {
    if ctx.accounts.output_mint.key() == SOL_MINT {
        msg!("Call the fill_wsol_order instruction");
        return Err(ProgramError::InvalidInstructionData.into());
    }

    let remaining = &ctx.remaining_accounts;
    let light_accounts = &remaining[0..10];

    validate_light_accounts(light_accounts, &expected_accounts(LightAccountSet::Update))?;

    require!(
        args.swap_data.len() >= 8,
        CustomError::InvalidJupInstructionData
    );

    let jup_data = parse_jupiter_route_data(&args.swap_data)?;

    let in_amount = jup_data.in_amount;
    // let out_amount = jup_data.out_amount;
    // TODO: change in frontend to
    // NOTE: the amount we get here already deducts the fee
    // so if the taking amount is 100 USDC and fee is 0.1% so here we get 99.9 USDC

    if jup_data.slippage_bps > 50 {
        return Err(error!(CustomError::SlippageTooHigh));
    }

    // hard coded 0.1%
    if jup_data.platform_fee_bps != 10 {
        return Err(error!(CustomError::InvalidPlatformFeeBps));
    }

    if jup_data.is_exact_out {
        return Err(error!(CustomError::InvalidJupInstructionData));
    }

    let jupiter_accounts = &remaining[10..];

    validate_jupiter_accounts(
        &jup_data.route,
        jupiter_accounts,
        ctx.accounts.input_mint.key(),
        ctx.accounts.output_mint.key(),
        ctx.accounts.input_token_program.key(),
        ctx.accounts.output_token_program.key(),
    )?;

    let balance_before_swap = ctx.accounts.protocol_vault_output_mint_ata.amount;

    swap_cpi(
        &args.swap_data,
        jupiter_accounts,
        &ctx.accounts.protocol_vault.to_account_info(),
        &ctx.accounts.jupiter_program,
    )?;

    ctx.accounts.protocol_vault_output_mint_ata.reload()?;

    let balance_after_swap = ctx.accounts.protocol_vault_output_mint_ata.amount;

    let diff = balance_after_swap
        .checked_sub(balance_before_swap)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    transfer_tokens(&ctx, diff)?;

    let escrow_account = args.escrow_account;

    match args.fill_type {
        FillType::Full => {
            if in_amount != escrow_account.amount.making_amount {
                return Err(error!(CustomError::InvalidInAmount));
            }

            // let expected_after_fee = escrow_account
            //     .amount
            //     .taking_amount
            //     .checked_mul((10_000u64 - escrow_account.fee_bps as u64))
            //     .ok_or(ProgramError::ArithmeticOverflow)?
            //     .checked_div(10_000)
            //     .ok_or(ProgramError::ArithmeticOverflow)?;

            // NOTE: hard coded 0.1% fee for now
            let expected_after_fee = escrow_account
                .amount
                .taking_amount
                .checked_mul(999)
                .ok_or(ProgramError::ArithmeticOverflow)?
                .checked_div(1000)
                .ok_or(ProgramError::ArithmeticOverflow)?;

            if expected_after_fee > diff {
                return Err(error!(CustomError::LowTakingAmount));
            }

            let escrow_address = light_cpi_close(&ctx, args, light_accounts)?;

            emit!(FillEvent {
                escrow_address,
                maker: ctx.accounts.maker.key(),
                input_mint: ctx.accounts.input_mint.key(),
                output_mint: ctx.accounts.output_mint.key(),
                unique_id: escrow_account.unique_id,
                in_amount,
                out_amount: diff,
                fee_bps: escrow_account.fee_bps,
                fill_type: FillType::Full,
            });
        }
        FillType::Partial => {
            if in_amount > escrow_account.amount.making_amount {
                return Err(ProgramError::InsufficientFunds.into());
            }

            let taking_amount = escrow_account
                .amount
                .taking_amount
                .checked_mul(in_amount)
                .ok_or(ProgramError::ArithmeticOverflow)?
                .checked_div(escrow_account.amount.making_amount)
                .ok_or(ProgramError::ArithmeticOverflow)?;

            let expected_after_fee = taking_amount
                .checked_mul(999)
                .ok_or(ProgramError::ArithmeticOverflow)?
                .checked_div(1000)
                .ok_or(ProgramError::ArithmeticOverflow)?;

            if expected_after_fee > diff {
                return Err(error!(CustomError::LowTakingAmount));
            }

            let escrow_address = light_cpi_update(&ctx, light_accounts, &args, in_amount, diff)?;

            emit!(FillEvent {
                escrow_address,
                maker: ctx.accounts.maker.key(),
                input_mint: ctx.accounts.input_mint.key(),
                output_mint: ctx.accounts.output_mint.key(),
                unique_id: escrow_account.unique_id,
                in_amount,
                out_amount: diff,
                fee_bps: escrow_account.fee_bps,
                fill_type: FillType::Partial,
            });
        }
    }

    Ok(())
}

fn transfer_tokens<'info>(
    ctx: &Context<'_, '_, '_, 'info, FillOrder<'info>>,
    amount: u64,
) -> Result<()> {
    let cpi_accounts = TransferChecked {
        from: ctx
            .accounts
            .protocol_vault_output_mint_ata
            .to_account_info(),
        to: ctx.accounts.maker_output_mint_ata.to_account_info(),
        authority: ctx.accounts.protocol_vault.to_account_info(),
        mint: ctx.accounts.output_mint.to_account_info(),
    };

    let cpi_transfer = CpiContext::new(
        ctx.accounts.output_token_program.to_account_info(),
        cpi_accounts,
    );

    let signer_seeds: &[&[&[u8]]] = &[&[PROTOCOL_VAULT_SEED, &[ctx.bumps.protocol_vault]]];

    transfer_checked(
        cpi_transfer.with_signer(signer_seeds),
        amount,
        ctx.accounts.output_mint.decimals,
    )?;

    Ok(())
}

fn light_cpi_close<'info>(
    ctx: &Context<'_, '_, '_, 'info, FillOrder<'info>>,
    args: FillOrderParams,
    light_accounts: &[AccountInfo<'info>],
) -> Result<Pubkey> {
    let escrow_account = args.escrow_account;

    let (address, _address_seed) = derive_address(
        &[
            b"escrow",
            escrow_account.unique_id.to_le_bytes().as_ref(),
            ctx.accounts.maker.key().as_ref(),
        ],
        &Pubkey::from_str("amt1Ayt45jfbdw5YSo7iz6WZxUmnZsQTYXy82hVwyC2")
            .map_err(|_| CustomError::InvalidMerkleTreePubkey)?,
        &crate::ID,
    );

    let account_meta = CompressedAccountMeta {
        address,
        tree_info: args.tree_info,
        output_state_tree_index: args.output_state_tree_index,
    };

    let escrow = LightAccount::<'_, EscrowAccount>::new_close(
        &crate::ID,
        &account_meta,
        EscrowAccount {
            maker: ctx.accounts.maker.key(),
            unique_id: escrow_account.unique_id,
            tokens: Tokens {
                input_mint: ctx.accounts.input_mint.key(),
                output_mint: ctx.accounts.output_mint.key(),
                input_token_program: ctx.accounts.input_token_program.key(),
                output_token_program: ctx.accounts.output_token_program.key(),
            },
            amount: escrow_account.amount,
            fee_bps: escrow_account.fee_bps,
            expired_at: escrow_account.expired_at,
            created_at: escrow_account.created_at,
            updated_at: escrow_account.updated_at,
        },
    )
    .map_err(ProgramError::from)?;

    require!(
        *escrow.owner() == crate::ID,
        ErrorCode::AccountOwnedByWrongProgram
    );

    require!(
        address == escrow.address().expect("invalid escrow address"),
        CustomError::InvalidEscrow
    );

    let cpi_accounts = light_sdk::cpi::CpiAccounts::new(
        ctx.accounts.payer.as_ref(),
        light_accounts,
        crate::LIGHT_CPI_SIGNER,
    );

    let escrow_address =
        Pubkey::new_from_array((*escrow.address()).expect("Address should be valid"));

    let cpi_inputs = light_sdk::cpi::CpiInputs::new(
        args.proof,
        vec![escrow.to_account_info().map_err(ProgramError::from)?],
    );

    cpi_inputs
        .invoke_light_system_program(cpi_accounts)
        .map_err(ProgramError::from)?;

    Ok(escrow_address)
}

pub fn light_cpi_update<'info>(
    ctx: &Context<'_, '_, '_, 'info, FillOrder<'info>>,
    light_accounts: &[AccountInfo<'info>],
    args: &FillOrderParams,
    making_amount: u64,
    taking_amount: u64,
) -> Result<Pubkey> {
    let escrow_account = args.escrow_account;

    let (address, _address_seed) = derive_address(
        &[
            b"escrow",
            escrow_account.unique_id.to_le_bytes().as_ref(),
            ctx.accounts.maker.key().as_ref(),
        ],
        &Pubkey::from_str("amt1Ayt45jfbdw5YSo7iz6WZxUmnZsQTYXy82hVwyC2")
            .map_err(|_| CustomError::InvalidMerkleTreePubkey)?,
        &crate::ID,
    );

    let account_meta = CompressedAccountMeta {
        address,
        tree_info: args.tree_info,
        output_state_tree_index: args.output_state_tree_index,
    };

    let mut escrow = LightAccount::<'_, EscrowAccount>::new_mut(
        &crate::ID,
        &account_meta,
        EscrowAccount {
            maker: ctx.accounts.maker.key(),
            unique_id: escrow_account.unique_id,
            tokens: Tokens {
                input_mint: ctx.accounts.input_mint.key(),
                output_mint: ctx.accounts.output_mint.key(),
                input_token_program: ctx.accounts.input_token_program.key(),
                output_token_program: ctx.accounts.output_token_program.key(),
            },
            amount: escrow_account.amount,
            fee_bps: escrow_account.fee_bps,
            expired_at: escrow_account.expired_at,
            created_at: escrow_account.created_at,
            updated_at: escrow_account.updated_at,
        },
    )
    .map_err(ProgramError::from)?;

    require!(
        *escrow.owner() == crate::ID,
        ErrorCode::AccountOwnedByWrongProgram
    );

    require!(
        address == escrow.address().expect("invalid escrow address"),
        CustomError::InvalidEscrow
    );

    escrow.amount.making_amount = escrow
        .amount
        .making_amount
        .checked_sub(making_amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    escrow.amount.taking_amount = escrow
        .amount
        .taking_amount
        .checked_sub(taking_amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    escrow.updated_at = Clock::get()?.unix_timestamp;

    let cpi_accounts = light_sdk::cpi::CpiAccounts::new(
        ctx.accounts.payer.as_ref(),
        light_accounts,
        crate::LIGHT_CPI_SIGNER,
    );

    let escrow_address =
        Pubkey::new_from_array((*escrow.address()).expect("Address should be valid"));

    let cpi_inputs = light_sdk::cpi::CpiInputs::new(
        args.proof,
        vec![escrow.to_account_info().map_err(ProgramError::from)?],
    );

    cpi_inputs
        .invoke_light_system_program(cpi_accounts)
        .map_err(ProgramError::from)?;

    Ok(escrow_address)
}

#[event]
pub struct FillEvent {
    pub escrow_address: Pubkey,
    pub maker: Pubkey,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub unique_id: u64,
    pub in_amount: u64,
    pub out_amount: u64,
    pub fee_bps: u16,
    pub fill_type: FillType,
}

// Jupiter route types
#[derive(AnchorDeserialize, Debug)]
pub struct Route {
    pub route_plan: Vec<RoutePlanStep>,
    pub in_amount: u64,
    pub quoted_out_amount: u64,
    pub slippage_bps: u16,
    pub platform_fee_bps: u8,
}

#[derive(AnchorDeserialize, Debug)]
pub struct SharedAccountsRoute {
    pub id: u8,
    pub route_plan: Vec<RoutePlanStep>,
    pub in_amount: u64,
    pub quoted_out_amount: u64,
    pub slippage_bps: u16,
    pub platform_fee_bps: u8,
}

#[derive(AnchorDeserialize, Debug)]
pub struct ExactOutRoute {
    pub route_plan: Vec<RoutePlanStep>,
    pub out_amount: u64,
    pub quoted_in_amount: u64,
    pub slippage_bps: u16,
    pub platform_fee_bps: u8,
}

#[derive(AnchorDeserialize, Debug)]
pub struct SharedAccountsExactOutRoute {
    pub id: u8,
    pub route_plan: Vec<RoutePlanStep>,
    pub out_amount: u64,
    pub quoted_in_amount: u64,
    pub slippage_bps: u16,
    pub platform_fee_bps: u8,
}

#[derive(AnchorDeserialize, Debug, PartialEq, Eq, Clone)]
pub enum JupiterRoutes {
    Route,
    SharedAccountsRoute,
    ExactOutRoute,
    SharedAccountsExactOutRoute,
}
