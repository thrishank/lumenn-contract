use std::str::FromStr;

use anchor_lang::prelude::*;

use light_sdk::{
    account::LightAccount,
    address::v1::derive_address,
    cpi::{CpiAccounts, CpiInputs},
    instruction::{account_meta::CompressedAccountMeta, ValidityProof},
};

use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{error::CustomError, state::EscrowAccount};

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The maker of the order - must be signer for non-expired orders
    /// For expired orders, anyone can cancel (including workers/keepers)
    /// CHECK: Verified in instruction logic based on expiration status
    pub maker: AccountInfo<'info>,

    pub input_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = input_mint,
        associated_token::authority = maker,
        associated_token::token_program = input_token_program
    )]
    pub maker_input_mint_ata: InterfaceAccount<'info, TokenAccount>,

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

    pub input_token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CancelOrderParams {
    pub escrow_account: EscrowAccount,
    pub proof: ValidityProof,
    pub account_meta: CompressedAccountMeta,
}

pub fn cancel<'info>(
    ctx: Context<'_, '_, '_, 'info, CancelOrder<'info>>,
    args: CancelOrderParams,
) -> Result<()> {
    let escrow_account = args.escrow_account;
    let escrow = LightAccount::<'_, EscrowAccount>::new_close(
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

    require!(
        escrow_account.tokens.input_mint == ctx.accounts.input_mint.key(),
        CustomError::InvalidInputMint
    );

    require!(
        escrow.tokens.input_token_program == ctx.accounts.input_token_program.key(),
        ErrorCode::InvalidProgramId
    );

    require!(
        escrow_account.maker == ctx.accounts.maker.key(),
        CustomError::InvalidEscrowMaker
    );

    require!(
        *escrow.owner() == crate::ID,
        ErrorCode::AccountOwnedByWrongProgram
    );

    let current_timestamp = Clock::get()?.unix_timestamp;
    let is_expired = escrow_account.expired_at > 0 && current_timestamp > escrow_account.expired_at;

    // For non-expired orders, only maker can cancel
    // For expired orders, anyone can cancel (cleanup mechanism)
    if !is_expired {
        require!(ctx.accounts.maker.is_signer, CustomError::Unauthorized);
    }

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

    if address != escrow.address().expect("Invalid escrow address") {
        return Err(error!(CustomError::InvalidEscrow));
    }

    let light_cpi_accounts = CpiAccounts::new(
        ctx.accounts.payer.as_ref(),
        ctx.remaining_accounts,
        crate::LIGHT_CPI_SIGNER,
    );

    let escrow_addrees =
        Pubkey::new_from_array((*escrow.address()).expect("Address should be valid"));

    let cpi_inputs = CpiInputs::new(
        args.proof,
        vec![escrow.to_account_info().map_err(ProgramError::from)?],
    );

    cpi_inputs
        .invoke_light_system_program(light_cpi_accounts)
        .map_err(ProgramError::from)?;

    let signer_seeds: [&[&[u8]]; 1] = [&[b"protocol_vault", &[ctx.bumps.protocol_vault]]];

    let transfer_accoutns = TransferChecked {
        from: ctx.accounts.protocol_vault_input_mint_ata.to_account_info(),
        to: ctx.accounts.maker_input_mint_ata.to_account_info(),
        mint: ctx.accounts.input_mint.to_account_info(),
        authority: ctx.accounts.protocol_vault.to_account_info(),
    };

    let cpi_transfer = CpiContext::new_with_signer(
        ctx.accounts.input_token_program.to_account_info(),
        transfer_accoutns,
        &signer_seeds,
    );

    emit!(OrderCancelled {
        escrow_addrees,
        maker: ctx.accounts.maker.key(),
        unique_id: escrow_account.unique_id,
        input_mint: ctx.accounts.input_mint.key(),
        output_mint: escrow_account.tokens.output_mint,
        is_expired,
        cancelled_by: ctx.accounts.payer.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    transfer_checked(
        cpi_transfer,
        escrow_account.amount.making_amount,
        ctx.accounts.input_mint.decimals,
    )
}

#[event]
pub struct OrderCancelled {
    pub escrow_addrees: Pubkey,
    pub maker: Pubkey,
    pub unique_id: u64,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub is_expired: bool,
    pub cancelled_by: Pubkey,
    pub timestamp: i64,
}
