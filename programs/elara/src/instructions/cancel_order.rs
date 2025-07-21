use anchor_lang::prelude::*;

use light_sdk::{
    account::LightAccount,
    address::v1::derive_address,
    cpi::{CpiAccounts, CpiInputs},
    instruction::{account_meta::CompressedAccountMeta, PackedAddressTreeInfo, ValidityProof},
};

use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{error::ErrorCode, state::EscrowAccount};

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub maker: Signer<'info>,

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

pub fn cancel<'info>(
    ctx: Context<'_, '_, '_, 'info, CancelOrder<'info>>,
    escrow_account: EscrowAccount,
    proof: ValidityProof,
    account_meta: CompressedAccountMeta,
) -> Result<()> {
    let escrow = LightAccount::<'_, EscrowAccount>::new_close(
        &crate::ID,
        &account_meta,
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

    if ctx.accounts.maker.key() != escrow.maker {
        return Err(error!(ErrorCode::Unauthorized));
    }

    if ctx.accounts.input_mint.key() != escrow.tokens.input_mint {
        return Err(error!(ErrorCode::InvalidInputMint));
    }

    let light_cpi_accounts = CpiAccounts::new(
        ctx.accounts.payer.as_ref(),
        ctx.remaining_accounts,
        crate::LIGHT_CPI_SIGNER,
    );

    let cpi_inputs = CpiInputs::new(
        proof,
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

    transfer_checked(
        cpi_transfer,
        escrow_account.amount.making_amount,
        ctx.accounts.input_mint.decimals,
    )
}
