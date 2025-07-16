use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

#[derive(Accounts)]
pub struct CreateTokenAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: This account is the owner of the new token account
    pub maker: UncheckedAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: check in program logic
    pub maker_token_ata: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn create_token_account(ctx: Context<CreateTokenAccount>, data: Vec<u8>) -> Result<()> {
    // The account is created by the associated token program
    // so we don't need to do anything here.
    Ok(())
}
