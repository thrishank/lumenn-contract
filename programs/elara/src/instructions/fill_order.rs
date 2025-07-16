use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::idl::types::RoutePlanStep;
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

    /// CHECK: order state account
    #[account(mut)]
    pub order: UncheckedAccount<'info>,

    pub input_mint: InterfaceAccount<'info, Mint>,

    pub output_mint: InterfaceAccount<'info, Mint>,

    // NOTE: commeting this for tests write chesk in the program later
    // pub maker_output_mint_ata: InterfaceAccount<'info, TokenAccount>,
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
    // NOTE: commeting this for tests write chesk in the program later
    // pub jupiter_program: Program<'info, Jupiter>,
}

pub fn fill(ctx: Context<FillOrder>, data: Vec<u8>) -> Result<()> {
    //  read the data from the zk
    //  check if the user has output mint token ata
    //  if not then swap tokens to 0.00204 SOL using ExactOut
    //  create the ata
    //  swap the tokens using Jupiter aggregator
    //  transfer the output tokens to the maker's output mint ata
    // ExactOut router and shared_accounts_exact_out_router
    if data[0] == 229 {
        msg!("main route");
        let mut input_data = &data[8..];
        let args = Route::deserialize(&mut input_data)?;
        msg!("quoted_in_amount {}", args.in_amount);
        msg!("out_amount {}", args.quoted_out_amount);
    }

    if data[0] == 193 {
        msg!("shared account route");
        let mut input_data = &data[8..];
        let args = SharedAccountsRoute::deserialize(&mut input_data)?;
        msg!("quoted_in_amount {}", args.in_amount);
        msg!("out_amount {}", args.quoted_out_amount);
    }

    if data[0] == 208 {
        let mut input_data = &data[8..];
        let args = ExactOutRoute::deserialize(&mut input_data)?;
        msg!("quoted_in_amount {}", args.quoted_in_amount);
        msg!("out_amount {}", args.out_amount);
    }

    if data[0] == 176 {
        msg!("shared accounts exact route route");
        let mut input_data = &data[8..];
        let args = SharedAccountsExactOutRoute::deserialize(&mut input_data)?;
        msg!("quoted_in_amount {}", args.quoted_in_amount);
        msg!("out_amount {}", args.out_amount);
    }

    Ok(())
}

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
