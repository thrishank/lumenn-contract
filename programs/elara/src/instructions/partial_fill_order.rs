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
    PROTOCOL_VAULT_SEED,
};

use jupiter::program::Jupiter;

declare_program!(jupiter);

#[derive(Accounts)]
pub struct PartialFill<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: check maker.key == order.maker
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
pub struct PartialFillOrderParams {
    pub swap_data: Vec<u8>,
    pub escrow_account: AccountParams,
    pub proof: ValidityProof,
    // pub account_meta: CompressedAccountMeta,
    // pub taking_amount: u64, // NOTE: here we do ExacOut. swap some making amount to a exact taking
    pub tree_info: PackedStateTreeInfo,
    pub output_state_tree_index: u8,
}

pub fn partial_fill<'info>(
    ctx: Context<'_, '_, '_, 'info, PartialFill<'info>>,
    args: PartialFillOrderParams,
) -> Result<()> {
    require!(
        args.swap_data.len() >= 8,
        CustomError::InvalidJupInstructionData
    );

    let remaining = &ctx.remaining_accounts;
    let light_accounts = &remaining[0..10];

    validate_light_accounts(light_accounts, &expected_accounts(LightAccountSet::Update))?;

    let jup_data = parse_jupiter_route_data(&args.swap_data)?;

    if jup_data.platform_fee_bps != 5 {
        return Err(error!(CustomError::InvalidPlatformFeeBps));
    }

    if !jup_data.is_exact_out {
        return Err(error!(CustomError::InvalidJupInstructionData));
    }

    let out_amount = jup_data.out_amount;
    let in_amount = jup_data.in_amount;
    let slippage_bps = jup_data.slippage_bps;

    let escrow_account = args.escrow_account;

    // if out_amount != args.taking_amount {
    //     return Err(error!(CustomError::InvalidOutAmount));
    // }

    if in_amount < escrow_account.amount.making_amount {
        return Err(ProgramError::InsufficientFunds.into());
    }

    if slippage_bps > escrow_account.slippage_bps {
        return Err(error!(CustomError::SlippageTooHigh));
    }

    let jupiter_accounts = &remaining[10..];

    // validate_jupiter_accounts(
    //     &jup_data.route,
    //     jupiter_accounts,
    //     ctx.accounts.input_mint.key(),
    //     ctx.accounts.output_mint.key(),
    //     ctx.accounts.input_token_program.key(),
    //     ctx.accounts.output_token_program.key(),
    // )?;
    //
    // swap_cpi(
    //     &args.swap_data,
    //     jupiter_accounts,
    //     &ctx.accounts.protocol_vault.to_account_info(),
    //     &ctx.accounts.jupiter_program,
    // )?;

    let escrow_address = light_cpi(&ctx, light_accounts, &args, in_amount, out_amount)?;
    transfer_tokens(&ctx, out_amount)?;

    emit!(PartialFillOrderEvent {
        escrow_address,
        maker: ctx.accounts.maker.key(),
        input_mint: ctx.accounts.input_mint.key(),
        output_mint: ctx.accounts.output_mint.key(),
        slippage_bps: escrow_account.slippage_bps,
        in_amount,
        out_amount,
        fee_bps: escrow_account.fee_bps,
    });
    Ok(())
}

pub fn transfer_tokens<'info>(
    ctx: &Context<'_, '_, '_, 'info, PartialFill<'info>>,
    amount: u64,
) -> Result<()> {
    let cpi_accounts = TransferChecked {
        from: ctx
            .accounts
            .protocol_vault_output_mint_ata
            .to_account_info(),
        to: ctx.accounts.maker_output_mint_ata.to_account_info(),
        authority: ctx.accounts.protocol_vault.to_account_info(),
        mint: ctx.accounts.input_mint.to_account_info(),
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

pub fn light_cpi<'info>(
    ctx: &Context<'_, '_, '_, 'info, PartialFill<'info>>,
    light_accounts: &[AccountInfo<'info>],
    args: &PartialFillOrderParams,
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
            .expect("Invalid merkle tree pubkey"),
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
            slippage_bps: escrow_account.slippage_bps,
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
pub struct PartialFillOrderEvent {
    pub escrow_address: Pubkey,
    pub maker: Pubkey,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub in_amount: u64,
    pub out_amount: u64,
    pub slippage_bps: u16,
    pub fee_bps: u16,
}
