use std::str::FromStr;

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    close_account, CloseAccount, Mint, TokenAccount, TokenInterface,
};

use crate::error::CustomError;

pub const ALLOWED_CALLER: &str = "thrbabBvANwvKdV34GdrFUDXB6YMsksdfmiKj2ZUV3m";

#[derive(Accounts)]
pub struct CloseProtocolAta<'info> {
    #[account(
        mut,
        constraint = payer.key() == Pubkey::from_str(ALLOWED_CALLER).unwrap()
    )]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"protocol_vault"],
        bump
    )]
    pub protocol_vault: SystemAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = protocol_vault,
        associated_token::token_program = token_program
    )]
    pub protocol_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn close_protocol_ata(ctx: Context<CloseProtocolAta>) -> Result<()> {
    let protocol_ata = &ctx.accounts.protocol_ata;

    if protocol_ata.amount != 0 {
        return Err(error!(CustomError::TokenAccountNotEmpty));
    }

    let signer_seeds: [&[&[u8]]; 1] = [&[b"protocol_vault", &[ctx.bumps.protocol_vault]]];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: protocol_ata.to_account_info(),
            destination: ctx.accounts.payer.to_account_info(),
            authority: ctx.accounts.protocol_vault.to_account_info(),
        },
        &signer_seeds,
    );

    close_account(cpi_ctx)?;

    Ok(())
}
