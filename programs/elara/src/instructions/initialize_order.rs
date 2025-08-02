use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use light_sdk::{
    account::LightAccount,
    address::v1::derive_address,
    cpi::{CpiAccounts, CpiInputs},
    instruction::{PackedAddressTreeInfo, ValidityProof},
};

use crate::{error::CustomError, state::EscrowAccount};

#[derive(Accounts)]
pub struct InitializeOrder<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub maker: Signer<'info>,

    pub input_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = input_mint,
        associated_token::authority = maker,
        associated_token::token_program = input_token_program
    )]
    pub maker_input_mint_ata: InterfaceAccount<'info, TokenAccount>,

    pub output_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = output_mint,
        associated_token::authority = maker,
        associated_token::token_program = output_token_program
    )]
    pub maker_output_mint_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"protocol_vault"],
        bump
    )]
    pub protocol_vault: SystemAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
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
}

pub fn init<'info>(
    ctx: Context<'_, '_, '_, 'info, InitializeOrder<'info>>,
    order_args: InitializeOrderParams,
    light_args: LightArgs,
) -> Result<()> {
    require!(order_args.making_amount > 0, CustomError::InvalidAmount);
    require!(order_args.taking_amount > 0, CustomError::InvalidAmount);

    require!(
        order_args.slippage_bps <= 10000,
        CustomError::InvalidSlippage
    ); // Max 100%

    require!(
        ctx.accounts.input_mint.key() != ctx.accounts.output_mint.key(),
        CustomError::SameMints
    );

    if let Some(expired_at) = order_args.expired_at {
        require!(
            expired_at > Clock::get()?.unix_timestamp,
            CustomError::InvalidExpiration
        );
    }

    let light_cpi_accounts = CpiAccounts::new(
        ctx.accounts.payer.as_ref(),
        ctx.remaining_accounts,
        crate::LIGHT_CPI_SIGNER,
    );

    let (address, address_seed) = derive_address(
        &[
            b"escrow",
            order_args.unique_id.to_le_bytes().as_ref(),
            ctx.accounts.maker.key().as_ref(),
        ],
        &light_args
            .address_tree_info
            .get_tree_pubkey(&light_cpi_accounts)
            .map_err(|_| ErrorCode::AccountNotEnoughKeys)?,
        &crate::ID,
    );

    let new_address_params = light_args
        .address_tree_info
        .into_new_address_params_packed(address_seed);

    let mut escrow = LightAccount::<'_, EscrowAccount>::new_init(
        &crate::ID,
        Some(address),
        light_args.output_state_tree_index,
    );

    escrow.maker = ctx.accounts.maker.key();
    escrow.unique_id = order_args.unique_id;
    escrow.tokens.input_mint = ctx.accounts.input_mint.key();
    escrow.tokens.output_mint = ctx.accounts.output_mint.key();
    escrow.tokens.input_token_program = ctx.accounts.input_token_program.key();
    escrow.tokens.output_token_program = ctx.accounts.output_token_program.key();
    escrow.amount.ori_making_amount = order_args.making_amount;
    escrow.amount.ori_taking_amount = order_args.taking_amount;
    escrow.amount.making_amount = order_args.making_amount;
    escrow.amount.taking_amount = order_args.taking_amount;
    escrow.slippage_bps = order_args.slippage_bps;
    escrow.fee_bps = 0; // TODO: set fee bps
    escrow.expired_at = order_args.expired_at.unwrap_or(0);
    escrow.created_at = Clock::get()?.unix_timestamp;
    escrow.updated_at = Clock::get()?.unix_timestamp;

    let escrow_address =
        Pubkey::new_from_array((*escrow.address()).expect("Address should be valid"));

    let cpi = CpiInputs::new_with_address(
        light_args.proof,
        vec![escrow.to_account_info().map_err(ProgramError::from)?],
        vec![new_address_params],
    );

    cpi.invoke_light_system_program(light_cpi_accounts)
        .map_err(ProgramError::from)?;
    emit!(OrderInitialized {
        escrow_address,
        maker: ctx.accounts.maker.key(),
        unique_id: order_args.unique_id,
        input_mint: ctx.accounts.input_mint.key(),
        output_mint: ctx.accounts.output_mint.key(),
        input_mint_decimals: ctx.accounts.input_mint.decimals,
        output_mint_decimals: ctx.accounts.output_mint.decimals,
        making_amount: order_args.making_amount,
        taking_amount: order_args.taking_amount,
        slippage_bps: order_args.slippage_bps,
        expired_at: order_args.expired_at.unwrap_or(0),
    });

    let transfer_accounts = TransferChecked {
        from: ctx.accounts.maker_input_mint_ata.to_account_info(),
        to: ctx.accounts.protocol_vault_input_mint_ata.to_account_info(),
        mint: ctx.accounts.input_mint.to_account_info(),
        authority: ctx.accounts.maker.to_account_info(),
    };

    let cpi_transfer = CpiContext::new(
        ctx.accounts.input_token_program.to_account_info(),
        transfer_accounts,
    );

    transfer_checked(
        cpi_transfer,
        order_args.making_amount,
        ctx.accounts.input_mint.decimals,
    )
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeOrderParams {
    pub unique_id: u64,
    pub making_amount: u64,
    pub taking_amount: u64,
    pub expired_at: Option<i64>,
    pub slippage_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct LightArgs {
    pub proof: ValidityProof,
    pub address_tree_info: PackedAddressTreeInfo,
    pub output_state_tree_index: u8,
}

// TODO: add decimals and create a instruction and self invoke for emit
#[event]
pub struct OrderInitialized {
    pub escrow_address: Pubkey,
    pub maker: Pubkey,
    pub unique_id: u64,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub input_mint_decimals: u8,
    pub output_mint_decimals: u8,
    pub making_amount: u64,
    pub taking_amount: u64,
    pub slippage_bps: u16,
    pub expired_at: i64,
}
