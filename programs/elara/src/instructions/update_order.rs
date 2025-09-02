use std::str::FromStr;

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use light_sdk::address::v1::derive_address;
use light_sdk::instruction::PackedStateTreeInfo;
use light_sdk::{
    account::LightAccount,
    instruction::{account_meta::CompressedAccountMeta, ValidityProof},
};

use crate::error::CustomError;
use crate::state::{AccountParams, EscrowAccount, Tokens};
use crate::utils::{expected_accounts, validate_light_accounts, LightAccountSet};
use crate::{LIGHT_CPI_SIGNER, PROTOCOL_VAULT_SEED};

#[derive(Accounts)]
pub struct UpdateOrder<'info> {
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

    pub input_token_program: Interface<'info, TokenInterface>,
    pub output_token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpdateOrderArgs {
    pub escrow_account: AccountParams,
    pub proof: ValidityProof,
    pub tree_info: PackedStateTreeInfo,
    pub output_state_tree_index: u8,

    pub making_amount: Option<u64>,
    pub taking_amount: Option<u64>,
    pub expired_at: Option<i64>,
}

pub fn update<'info>(
    ctx: Context<'_, '_, '_, 'info, UpdateOrder<'info>>,
    args: UpdateOrderArgs,
) -> Result<()> {
    require_keys_neq!(
        ctx.accounts.input_mint.key(),
        ctx.accounts.output_mint.key(),
        CustomError::SameMints
    );

    if let Some(ma) = args.making_amount {
        require!(ma > 0, CustomError::InvalidAmount);
    }

    if let Some(ta) = args.taking_amount {
        require!(ta > 0, CustomError::InvalidAmount);
    }

    if let Some(exp) = args.expired_at {
        if exp != 0 {
            require!(
                exp > Clock::get()?.unix_timestamp,
                CustomError::InvalidExpiration
            );
        }
    }

    let escrow_address = light_cpi(&ctx, ctx.remaining_accounts, &args)?;

    if let Some(new_making) = args.making_amount {
        let old_making = args.escrow_account.amount.making_amount;

        match new_making.cmp(&old_making) {
            core::cmp::Ordering::Equal => {}
            core::cmp::Ordering::Greater => {
                let diff = new_making - old_making;

                // Transfer the difference from the maker to the protocol vault

                transfer_checked(
                    CpiContext::new(
                        ctx.accounts.input_token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.maker_input_mint_ata.to_account_info(),
                            to: ctx.accounts.protocol_vault_input_mint_ata.to_account_info(),
                            mint: ctx.accounts.input_mint.to_account_info(),
                            authority: ctx.accounts.maker.to_account_info(),
                        },
                    ),
                    diff,
                    ctx.accounts.input_mint.decimals,
                )?;
            }
            core::cmp::Ordering::Less => {
                let diff = old_making - new_making;

                // Transfer the difference from the protocol vault to the maker

                let signer_seeds: &[&[&[u8]]] =
                    &[&[PROTOCOL_VAULT_SEED, &[ctx.bumps.protocol_vault]]];

                transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.input_token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.protocol_vault_input_mint_ata.to_account_info(),
                            to: ctx.accounts.maker_input_mint_ata.to_account_info(),
                            mint: ctx.accounts.input_mint.to_account_info(),
                            authority: ctx.accounts.protocol_vault.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    diff,
                    ctx.accounts.input_mint.decimals,
                )?;
            }
        }
    }

    emit!(OrderUpdateEvent {
        escrow_address,
        maker: ctx.accounts.maker.key(),
        unique_id: args.escrow_account.unique_id,
        input_mint: ctx.accounts.input_mint.key(),
        output_mint: ctx.accounts.output_mint.key(),
        input_mint_decimals: ctx.accounts.input_mint.decimals,
        output_mint_decimals: ctx.accounts.output_mint.decimals,
        making_amount: args
            .making_amount
            .unwrap_or(args.escrow_account.amount.making_amount),
        taking_amount: args
            .taking_amount
            .unwrap_or(args.escrow_account.amount.taking_amount),
        slippage_bps: args.escrow_account.slippage_bps,
        expired_at: args.expired_at.unwrap_or(args.escrow_account.expired_at),
    });

    Ok(())
}

fn light_cpi<'info>(
    ctx: &Context<'_, '_, '_, 'info, UpdateOrder<'info>>,
    light_accounts: &[AccountInfo<'info>],
    args: &UpdateOrderArgs,
) -> Result<Pubkey> {
    validate_light_accounts(
        ctx.remaining_accounts,
        &expected_accounts(LightAccountSet::Update),
    )?;

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

    let escrow_address =
        Pubkey::new_from_array((*escrow.address()).expect("Address should be valid"));

    require!(
        *escrow.owner() == crate::ID,
        ErrorCode::AccountOwnedByWrongProgram
    );

    require!(
        address == escrow.address().expect("invalid escrow address"),
        CustomError::InvalidEscrow
    );

    if let Some(ma) = args.making_amount {
        escrow.amount.making_amount = ma;
        escrow.amount.ori_making_amount = ma;
    }

    if let Some(ta) = args.taking_amount {
        escrow.amount.taking_amount = ta;
        escrow.amount.ori_taking_amount = ta;
    }

    if let Some(exp) = args.expired_at {
        escrow.expired_at = exp;
    }

    escrow.updated_at = Clock::get()?.unix_timestamp;

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

    Ok(escrow_address)
}

#[event]
pub struct OrderUpdateEvent {
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
