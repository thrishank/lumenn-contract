use std::str::FromStr;

use anchor_lang::prelude::*;
use anchor_spl::token::spl_token;
use anchor_spl::{
    associated_token::{get_associated_token_address, AssociatedToken},
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
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
use crate::utils::{
    expected_accounts, validate_jupiter_accounts, validate_light_accounts, LightAccountSet,
};
use crate::{
    error::CustomError, state::EscrowAccount, swap_cpi, LIGHT_CPI_SIGNER, PROTOCOL_VAULT_SEED,
};

use crate::{parse_jupiter_route_data, SOL_MINT};

#[derive(Accounts)]
pub struct CreateToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = sol_mint,
        associated_token::authority = payer,
        associated_token::token_program = token_program
    )]
    pub payer_wsol_ata: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Maker account  
    pub maker: AccountInfo<'info>,

    /// Maker token ATA to be created
    #[account(
        init,
        payer = payer,
        associated_token::mint = output_mint,
        associated_token::authority = maker,
        associated_token::token_program = output_token_program
    )]
    pub maker_token_ata: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: SOL mint (Native Mint, fixed address)
    #[account(address = spl_token::native_mint::ID)]
    pub sol_mint: UncheckedAccount<'info>,

    pub input_mint: InterfaceAccount<'info, Mint>,
    pub output_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"protocol_vault"],
        bump
    )]
    pub protocol_vault: SystemAccount<'info>,

    /// CHECK: Protocol WSOL ATA
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = sol_mint,
        associated_token::authority = protocol_vault,
        associated_token::token_program = token_program
    )]
    pub protocol_wsol_ata: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Hardcoded SPL Token program
    #[account(address = spl_token::ID)]
    pub token_program: UncheckedAccount<'info>,

    pub input_token_program: Interface<'info, TokenInterface>,
    pub output_token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub jupiter_program: Program<'info, Jupiter>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateTokenAccountArgs {
    pub swap_data: Vec<u8>,
    pub taking_amount: u64, // NOTE: not fully decentalized. Even if this data is corrupted, when
    // doing the final swap we just check out amount > taking amount. So no big problem here
    pub escrow_account: AccountParams,
    pub proof: ValidityProof,
    pub tree_info: PackedStateTreeInfo,
    pub output_state_tree_index: u8,
}

pub fn create_token_account<'info>(
    ctx: Context<'_, '_, '_, 'info, CreateToken<'info>>,
    args: CreateTokenAccountArgs,
) -> Result<()> {
    // NOTE: if output mint is WSOL then no need the ATA creation
    if ctx.accounts.output_mint.key() == SOL_MINT {
        return Err(error!(CustomError::TokenAccountAlreadyExists));
    };

    // NOTE: if input mint is WSOL then no need to swap
    if ctx.accounts.input_mint.key() == SOL_MINT {
        return Err(error!(CustomError::InvalidCreateAtaInstruction));
    }

    let remaining = &ctx.remaining_accounts;
    let light_accounts = &remaining[0..10];

    validate_light_accounts(light_accounts, &expected_accounts(LightAccountSet::Update))?;

    let jup_data = parse_jupiter_route_data(&args.swap_data)?;

    let rent = Rent::get()?;
    let ata_creation_amount =
        rent.minimum_balance(ctx.accounts.maker_token_ata.to_account_info().data_len());

    if jup_data.slippage_bps > 50 {
        return Err(error!(CustomError::SlippageTooHigh));
    }

    if jup_data.platform_fee_bps != 0 {
        return Err(error!(CustomError::InvalidPlatformFeeBps));
    }

    let jupiter_accounts = &remaining[10..];

    validate_jupiter_accounts(
        &jup_data.route,
        jupiter_accounts,
        ctx.accounts.input_mint.key(),
        SOL_MINT,
        ctx.accounts.input_token_program.key(),
        ctx.accounts.token_program.key(),
    )?;

    let balance_before_swap = ctx.accounts.protocol_wsol_ata.amount;

    swap_cpi(
        &args.swap_data,
        jupiter_accounts,
        &ctx.accounts.protocol_vault.to_account_info(),
        &ctx.accounts.jupiter_program,
    )?;

    let balance_after_swap = ctx.accounts.protocol_wsol_ata.amount;

    let diff = balance_after_swap
        .checked_sub(balance_before_swap)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    require!(diff > 0, CustomError::NoTokensReceived);

    if jup_data.is_exact_out && diff != ata_creation_amount {
        return Err(error!(CustomError::InvalidOutAmount));
    }

    if !jup_data.is_exact_out {
        if diff < ata_creation_amount {
            return Err(error!(CustomError::InvalidOutAmount));
        }

        // 1000 lamports tolarance
        if diff > ata_creation_amount + 1000 {
            return Err(error!(CustomError::InvalidOutAmount));
        }
    }

    transfer_tokens(&ctx, ata_creation_amount)?;

    light_cpi(
        &ctx,
        light_accounts,
        &args,
        jup_data.in_amount,
        args.taking_amount,
    )
}

fn transfer_tokens<'info>(
    ctx: &Context<'_, '_, '_, 'info, CreateToken<'info>>,
    amount: u64,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.payer_wsol_ata.key(),
        get_associated_token_address(&ctx.accounts.payer.key(), &SOL_MINT),
        CustomError::InvalidTokenAccount
    );

    require_keys_eq!(
        ctx.accounts.protocol_wsol_ata.key(),
        get_associated_token_address(&ctx.accounts.protocol_vault.key(), &SOL_MINT),
        CustomError::InvalidTokenAccount
    );

    require_keys_eq!(
        ctx.accounts.sol_mint.key(),
        SOL_MINT,
        CustomError::InvalidMint
    );

    require_keys_eq!(
        ctx.accounts.token_program.key(),
        spl_token::ID,
        CustomError::InvalidTokenProgramId
    );

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.protocol_wsol_ata.to_account_info(),
        to: ctx.accounts.payer_wsol_ata.to_account_info(),
        authority: ctx.accounts.protocol_vault.to_account_info(),
        mint: ctx.accounts.sol_mint.to_account_info(),
    };

    let cpi_transfer = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);

    let signer_seeds: &[&[&[u8]]] = &[&[PROTOCOL_VAULT_SEED, &[ctx.bumps.protocol_vault]]];

    transfer_checked(cpi_transfer.with_signer(signer_seeds), amount, 9)?;

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

    // NOTE: get the equivalent taking amount and subtract it from the state
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
