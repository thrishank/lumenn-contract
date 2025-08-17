use std::str::FromStr;

use anchor_lang::prelude::*;
use anchor_spl::associated_token::{create, Create};
use anchor_spl::{
    associated_token::{get_associated_token_address, AssociatedToken},
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use light_sdk::address::v1::derive_address;
use light_sdk::instruction::PackedStateTreeInfo;
use light_sdk::{
    account::LightAccount,
    instruction::{account_meta::CompressedAccountMeta, ValidityProof},
};

use jupiter::program::Jupiter;

declare_program!(jupiter);

use crate::state::{AccountParams, Tokens};
use crate::utils::validate_jupiter_accounts;
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

    // pub mint: InterfaceAccount<'info, Mint>,
    pub input_mint: InterfaceAccount<'info, Mint>,
    pub output_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: check in program logic
    #[account(mut)]
    pub maker_token_ata: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"protocol_vault"],
        bump
    )]
    pub protocol_vault: SystemAccount<'info>,

    // #[account(
    //     mut,
    //     associated_token::mint = input_mint,
    //     associated_token::authority = protocol_vault,
    //     associated_token::token_program = input_token_program
    // )]
    // pub protocol_vault_input_mint_ata: InterfaceAccount<'info, TokenAccount>,
    pub input_token_program: Interface<'info, TokenInterface>,
    pub output_token_program: Interface<'info, TokenInterface>,

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
    pub escrow_account: AccountParams,
    pub proof: ValidityProof,
    pub tree_info: PackedStateTreeInfo,
    pub output_state_tree_index: u8,
}

pub fn create_token_account<'info>(
    ctx: Context<'_, '_, '_, 'info, CreateToken<'info>>,
    args: CreateTokenAccountArgs,
) -> Result<()> {
    let expected_ata =
        get_associated_token_address(&ctx.accounts.maker.key(), &ctx.accounts.output_mint.key());

    if ctx.accounts.maker_token_ata.key() != expected_ata {
        return Err(error!(CustomError::InvalidTokenAccount));
    }

    if !ctx.accounts.maker_token_ata.data_is_empty() {
        return Err(error!(CustomError::TokenAccountAlreadyExists));
    }

    let remaining = &ctx.remaining_accounts;
    let light_accounts = &remaining[0..10];

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

    let is_making_sol = ctx.accounts.input_mint.key().to_string() == SOL_MINT;

    if is_making_sol {
        return Err(error!(CustomError::InvalidCreateAtaInstruction));
    }

    // let jupiter_accounts = &remaining[10..];
    //
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
    //     &ctx.accounts.jupiter_program,
    //     &ctx.accounts.protocol_vault.to_account_info(),
    // )?;

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
        mint: ctx.accounts.output_mint.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        token_program: ctx.accounts.output_token_program.to_account_info(),
    };

    let cpi_program = ctx.accounts.associated_token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

    let signer_seeds: &[&[&[u8]]] = &[&[PROTOCOL_VAULT_SEED, &[ctx.bumps.protocol_vault]]];

    create(cpi_ctx.with_signer(signer_seeds))?;

    Ok(())
}
