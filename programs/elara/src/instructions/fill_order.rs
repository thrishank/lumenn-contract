use anchor_lang::{
    prelude::*,
    solana_program::{instruction::Instruction, program::invoke_signed},
};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use light_sdk::{
    account::LightAccount,
    instruction::{account_meta::CompressedAccountMeta, ValidityProof},
};

use crate::{
    error::ErrorCode, idl::types::RoutePlanStep, state::EscrowAccount, PROTOCOL_VAULT_SEED,
};
use jupiter_aggregator::program::Jupiter;

declare_program!(jupiter_aggregator);
declare_program!(idl);

#[derive(Accounts)]
pub struct FillOrder<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: check maker.key == order.maker
    #[account(mut)]
    pub maker: UncheckedAccount<'info>,

    pub input_mint: InterfaceAccount<'info, Mint>,

    pub output_mint: InterfaceAccount<'info, Mint>,

    pub maker_output_mint_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"protocol_vault"],
        bump
    )]
    pub protocol_vault: SystemAccount<'info>,

    #[account(
        mut,
        associated_token::mint = input_mint,
        associated_token::authority = protocol_vault,
        associated_token::token_program = input_token_program
    )]
    pub protocol_vault_input_mint_ata: InterfaceAccount<'info, TokenAccount>,

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
    pub escrow_account: EscrowAccount,
    pub proof: ValidityProof,
    pub account_meta: CompressedAccountMeta,
}

pub fn fill<'info>(
    ctx: Context<'_, '_, '_, 'info, FillOrder<'info>>,
    args: FillOrderParams,
) -> Result<()> {
    if args.swap_data.len() < 8 {
        return Err(error!(ErrorCode::InvalidJupInstructionData));
    }

    if args.escrow_account.maker != ctx.accounts.maker.key() {
        return Err(error!(ErrorCode::InvalidEscrowMaker));
    }

    // FIXME: validate the accounts
    let remaining = &ctx.remaining_accounts;
    let light_accounts = &remaining[0..10];
    let jupiter_accounts = &remaining[10..];

    let mut input_data = &args.swap_data[8..];
    let escrow_account = args.escrow_account;

    // FIXME: match the full route discrimator all 8 bytes
    let (in_amount, quoted_out_amount, slippage_bps) = match args.swap_data[0] {
        229 => {
            let route_data = Route::deserialize(&mut input_data)?;
            (
                route_data.in_amount,
                route_data.quoted_out_amount,
                route_data.slippage_bps,
            )
        }
        193 => {
            let route_data = SharedAccountsRoute::deserialize(&mut input_data)?;
            (
                route_data.in_amount,
                route_data.quoted_out_amount,
                route_data.slippage_bps,
            )
        }
        _ => return Err(error!(ErrorCode::InvalidJupInstructionData)),
    };

    if in_amount != escrow_account.amount.making_amount {
        return Err(error!(ErrorCode::InvalidInAmount));
    }

    if quoted_out_amount <= escrow_account.amount.taking_amount {
        return Err(error!(ErrorCode::LowTakingAmount));
    }

    if slippage_bps > escrow_account.slippage_bps {
        return Err(error!(ErrorCode::SlippageTooHigh));
    }

    swap_cpi(&ctx, &args.swap_data, jupiter_accounts)?;
    light_cpi_close(&ctx, args, light_accounts)?;
    transfer_tokens(&ctx, escrow_account.amount.taking_amount)?;
    Ok(())
}

pub fn swap_cpi<'info>(
    ctx: &Context<'_, '_, '_, 'info, FillOrder<'info>>,
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

    // NOTE: hardcode the bump across all the instructions
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

pub fn transfer_tokens<'info>(
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

pub fn light_cpi_close<'info>(
    ctx: &Context<'_, '_, '_, 'info, FillOrder<'info>>,
    args: FillOrderParams,
    light_accounts: &[AccountInfo<'info>],
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

    let cpi_accounts = light_sdk::cpi::CpiAccounts::new(
        ctx.accounts.payer.as_ref(),
        light_accounts,
        crate::LIGHT_CPI_SIGNER,
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
