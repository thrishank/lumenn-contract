use std::str::FromStr;

use anchor_lang::prelude::*;

use light_sdk::{
    account::LightAccount,
    address::v1::derive_address,
    cpi::{CpiAccounts, CpiInputs},
    instruction::account_meta::CompressedAccountMeta,
};

use anchor_spl::{
    associated_token::AssociatedToken,
    token::{close_account, spl_token, CloseAccount},
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{
    error::CustomError,
    instructions::{CancelOrderParams, OrderCancelled},
    state::{EscrowAccount, Tokens},
    utils::{expected_accounts, validate_light_accounts, LightAccountSet},
    ATA_CREATION_AMOUNT,
};

#[derive(Accounts)]
pub struct ExpireOrder<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = sol_mint,
        associated_token::authority = payer,
        associated_token::token_program = input_token_program
    )]
    pub payer_wsol_ata: InterfaceAccount<'info, TokenAccount>,

    /// For expired orders, anyone can cancel (including workers/keepers)
    /// CHECK: Verified in instruction logic for expiration status
    #[account(mut)]
    pub maker: AccountInfo<'info>,

    #[account(address = spl_token::native_mint::ID)]
    pub sol_mint: InterfaceAccount<'info, Mint>,
    pub output_mint: InterfaceAccount<'info, Mint>,

    #[account(
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
        seeds = [b"temp_account"],
        bump
    )]
    pub temp_account: SystemAccount<'info>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = sol_mint,
        associated_token::authority = temp_account,
        associated_token::token_program = input_token_program
    )]
    pub temp_wsol_ata: InterfaceAccount<'info, TokenAccount>,

    pub input_token_program: Interface<'info, TokenInterface>,
    pub output_token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn expire<'info>(
    ctx: Context<'_, '_, '_, 'info, ExpireOrder<'info>>,
    args: CancelOrderParams,
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

    let escrow = LightAccount::<'_, EscrowAccount>::new_close(
        &crate::ID,
        &account_meta,
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
            slippage_bps: escrow_account.slippage_bps,
            fee_bps: escrow_account.fee_bps,
            expired_at: escrow_account.expired_at,
            created_at: escrow_account.created_at,
            updated_at: escrow_account.updated_at,
        },
    )
    .map_err(ProgramError::from)?;

    let current_timestamp = Clock::get()?.unix_timestamp;
    let is_expired = escrow_account.expired_at > 0 && current_timestamp > escrow_account.expired_at;

    if !is_expired {
        return Err(CustomError::OrderNotExpired.into());
    }

    if address != escrow.address().expect("Invalid escrow address") {
        return Err(error!(CustomError::InvalidEscrow));
    }

    validate_light_accounts(
        ctx.remaining_accounts,
        &expected_accounts(LightAccountSet::Close),
    )?;

    let light_cpi_accounts = CpiAccounts::new(
        ctx.accounts.payer.as_ref(),
        ctx.remaining_accounts,
        crate::LIGHT_CPI_SIGNER,
    );

    let escrow_address =
        Pubkey::new_from_array((*escrow.address()).expect("Address should be valid"));

    let cpi_inputs = CpiInputs::new(
        args.proof,
        vec![escrow.to_account_info().map_err(ProgramError::from)?],
    );

    cpi_inputs
        .invoke_light_system_program(light_cpi_accounts)
        .map_err(ProgramError::from)?;

    let signer_seeds: [&[&[u8]]; 1] = [&[b"protocol_vault", &[ctx.bumps.protocol_vault]]];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.input_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.protocol_vault_input_mint_ata.to_account_info(),
                to: ctx.accounts.temp_wsol_ata.to_account_info(),
                mint: ctx.accounts.sol_mint.to_account_info(),
                authority: ctx.accounts.protocol_vault.to_account_info(),
            },
            &signer_seeds,
        ),
        escrow_account.amount.making_amount - ATA_CREATION_AMOUNT,
        ctx.accounts.sol_mint.decimals,
    )?;

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.input_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.protocol_vault_input_mint_ata.to_account_info(),
                to: ctx.accounts.payer_wsol_ata.to_account_info(),
                mint: ctx.accounts.sol_mint.to_account_info(),
                authority: ctx.accounts.protocol_vault.to_account_info(),
            },
            &signer_seeds,
        ),
        ATA_CREATION_AMOUNT,
        ctx.accounts.sol_mint.decimals,
    )?;

    let temp_signer_seeds: [&[&[u8]]; 1] = [&[b"temp_account", &[ctx.bumps.temp_account]]];

    close_account(CpiContext::new_with_signer(
        ctx.accounts.input_token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.temp_wsol_ata.to_account_info(),
            destination: ctx.accounts.maker.to_account_info(),
            authority: ctx.accounts.temp_account.to_account_info(),
        },
        &temp_signer_seeds,
    ))?;

    emit!(OrderCancelled {
        escrow_address,
        maker: ctx.accounts.maker.key(),
        input_mint: ctx.accounts.sol_mint.key(),
        output_mint: ctx.accounts.output_mint.key(),
        making_amount: escrow_account.amount.making_amount,
        taking_amount: escrow_account.amount.taking_amount,
        unique_id: escrow_account.unique_id,
        is_expired: true,
        cancelled_by: ctx.accounts.payer.key(),
        timestamp: escrow_account.expired_at,
    });

    Ok(())
}
