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
    error::ErrorCode,
    instructions::{ExactOutRoute, SharedAccountsExactOutRoute},
    state::EscrowAccount,
    PROTOCOL_VAULT_SEED,
};
use jupiter_aggregator::program::Jupiter;

declare_program!(jupiter_aggregator);

#[derive(Accounts)]
pub struct PartialFill<'info> {
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
pub struct PartialFillOrderParams {
    pub swap_data: Vec<u8>,
    pub escrow_account: EscrowAccount,
    pub proof: ValidityProof,
    pub account_meta: CompressedAccountMeta,
    pub taking_amount: u64,
}

pub fn flash_fill_order<'info>(
    ctx: Context<'_, '_, '_, 'info, PartialFill<'info>>,
    args: PartialFillOrderParams,
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

    let (in_amount, out_amount, slippage_bps) = match args.swap_data[0] {
        208 => {
            let route_data = ExactOutRoute::deserialize(&mut input_data)?;
            (
                route_data.quoted_in_amount,
                route_data.out_amount,
                route_data.slippage_bps,
            )
        }
        176 => {
            let route_data = SharedAccountsExactOutRoute::deserialize(&mut input_data)?;
            (
                route_data.quoted_in_amount,
                route_data.out_amount,
                route_data.slippage_bps,
            )
        }
        _ => return Err(error!(ErrorCode::InvalidJupInstructionData)),
    };

    if out_amount != args.taking_amount {
        return Err(error!(ErrorCode::InvalidOutAmount));
    }

    if in_amount < escrow_account.amount.making_amount {
        return Err(ProgramError::InsufficientFunds.into());
    }

    if slippage_bps > escrow_account.slippage_bps {
        return Err(error!(ErrorCode::SlippageTooHigh));
    }

    swap_cpi(&ctx, &args.swap_data, jupiter_accounts)?;
    light_cpi(&ctx, light_accounts, &args, in_amount, out_amount)?;
    // add transfer instruction to move tokens from protocol vault to maker

    Ok(())
}

pub fn swap_cpi<'info>(
    ctx: &Context<'_, '_, '_, 'info, PartialFill<'info>>,
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
    ctx: &Context<'_, '_, '_, 'info, PartialFill<'info>>,
    light_accounts: &[AccountInfo<'info>],
    args: &PartialFillOrderParams,
    making_amount: u64,
    taking_amount: u64,
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

    let cpi_inputs = light_sdk::cpi::CpiInputs::new(
        args.proof,
        vec![escrow.to_account_info().map_err(ProgramError::from)?],
    );

    cpi_inputs
        .invoke_light_system_program(cpi_accounts)
        .map_err(ProgramError::from)?;

    Ok(())
}
