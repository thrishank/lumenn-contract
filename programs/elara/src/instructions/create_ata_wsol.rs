use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::spl_token,
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use light_sdk::{
    account::LightAccount,
    instruction::{account_meta::CompressedAccountMeta, ValidityProof},
};

use crate::{
    error::CustomError,
    parse_jupiter_route_data,
    state::{AccountParams, EscrowAccount, Tokens},
    utils::{expected_accounts, validate_light_accounts, LightAccountSet},
    LIGHT_CPI_SIGNER, PROTOCOL_VAULT_SEED,
};

#[derive(Accounts)]
pub struct CreateTokenWsol<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: LIGHT Proof verfication check this account
    pub maker: AccountInfo<'info>,

    #[account(address = spl_token::native_mint::ID)]
    pub sol_mint: InterfaceAccount<'info, Mint>,

    pub output_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = output_mint,
        associated_token::authority = maker,
        associated_token::token_program = output_token_program
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
        associated_token::token_program = input_token_program
    )]
    pub protocol_vault_input_mint_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = sol_mint,
        associated_token::authority = payer,
        associated_token::token_program = input_token_program

    )]
    pub payer_wsol_mint_ata: InterfaceAccount<'info, TokenAccount>,

    pub input_token_program: Interface<'info, TokenInterface>,
    pub output_token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateTokenAccountWsolArgs {
    pub swap_data: Vec<u8>,
    pub escrow_account: AccountParams,
    pub proof: ValidityProof,
    pub account_meta: CompressedAccountMeta,
}

pub fn create_token_account<'info>(
    ctx: Context<'_, '_, '_, 'info, CreateTokenWsol<'info>>,
    args: CreateTokenAccountWsolArgs,
) -> Result<()> {
    validate_light_accounts(
        ctx.remaining_accounts,
        &expected_accounts(LightAccountSet::Update),
    )?;

    let jup_data = parse_jupiter_route_data(&args.swap_data)?;

    let rent = Rent::get()?;
    let ata_creation_amount =
        rent.minimum_balance(ctx.accounts.maker_token_ata.to_account_info().data_len());

    // taking amount that is need to subtract in the state
    if jup_data.out_amount != ata_creation_amount {
        return Err(error!(CustomError::InvalidOutAmount));
    }

    transfer_sol_from_vault(&ctx, ata_creation_amount)?;

    light_cpi(&ctx, &args, ata_creation_amount, jup_data.in_amount)
}

fn light_cpi<'info>(
    ctx: &Context<'_, '_, '_, 'info, CreateTokenWsol<'info>>,
    args: &CreateTokenAccountWsolArgs,
    ata_creation_amount: u64,
    amount_swapped: u64,
) -> Result<()> {
    let escrow_account = args.escrow_account;

    let mut escrow = LightAccount::<'_, EscrowAccount>::new_mut(
        &crate::ID,
        &args.account_meta,
        EscrowAccount {
            maker: ctx.accounts.maker.key(),
            unique_id: escrow_account.unique_id,
            tokens: Tokens {
                input_mint: ctx.accounts.sol_mint.key(),
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

    escrow.amount.making_amount = escrow
        .amount
        .making_amount
        .checked_sub(ata_creation_amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

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
        ctx.accounts.input_token_program.to_account_info(),
        cpi_transfer_accounts,
    );

    let signer_seeds: &[&[&[u8]]] = &[&[PROTOCOL_VAULT_SEED, &[ctx.bumps.protocol_vault]]];

    transfer_checked(
        cpi_transfer.with_signer(signer_seeds),
        amount,
        ctx.accounts.sol_mint.decimals,
    )
}
