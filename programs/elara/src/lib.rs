#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};
use light_sdk::{cpi::CpiSigner, derive_light_cpi_signer};

declare_id!("LUMENWrdxm6FaNpmVY86KTP6ihYv8B74eoHGYkksNaP");

pub const LIGHT_CPI_SIGNER: CpiSigner =
    derive_light_cpi_signer!("LUMENWrdxm6FaNpmVY86KTP6ihYv8B74eoHGYkksNaP");

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

pub use constants::*;
use instructions::*;

use crate::error::CustomError;

solana_security_txt::security_txt! {
    name: "Lumenn Limit Order Program V1",
    contacts: "thris.dev@gmail.com",
    source_code: "https://github.com/thrishank/elara",
    project_url: "https://lumenn.xyz/",
    policy: "https://github.com/thrishank/elara/blob/main/SECURITY.md",
    preferred_languages: "en"
}

#[program]
pub mod elara {

    use super::*;

    /// This function creates a compressed escrow account using Light Protocol's state compression
    /// stores the order details amount and tokens
    /// Transfers the maker's input tokens to the protocol vault
    pub fn initialize_order<'info>(
        ctx: Context<'_, '_, '_, 'info, InitializeOrder<'info>>,
        init_order_args: InitializeOrderParams,
        light_args: LightArgs,
    ) -> Result<()> {
        initialize_order::init(ctx, init_order_args, light_args)
    }

    /// cancel an existing order by maker or cancel when expired
    /// returns the tokens back to the maker and close the compressed escrow PDA aacount
    pub fn cancel_order<'info>(
        ctx: Context<'_, '_, '_, 'info, CancelOrder<'info>>,
        args: CancelOrderParams,
    ) -> Result<()> {
        cancel_order::cancel(ctx, args)
    }

    /// when the input_mint is WSOL, to unwrap it back to sol, during cancel the wsol is transferrred to maker wsol ata
    /// the maker ata can only be closed by the maker. so while expiring the order we can't unwrap
    /// since the funds are stored in a protocol vault, and can't close it. So we will create a new
    /// temporary ata owned the Program, transfer the wsol to that ata and close it with
    /// destination = maker. this will unwrap the wsol back to SOL
    /// friction less limit orders mf
    pub fn expire_wsol_order<'info>(
        ctx: Context<'_, '_, '_, 'info, ExpireOrder<'info>>,
        args: CancelOrderParams,
    ) -> Result<()> {
        expire_wsol_order::expire(ctx, args)
    }

    /// Update an existing order, change the making and taking amount
    /// change the expiry time
    pub fn update_order<'info>(
        ctx: Context<'_, '_, '_, 'info, UpdateOrder<'info>>,
        args: UpdateOrderArgs,
    ) -> Result<()> {
        update_order::update(ctx, args)
    }

    /// To send the output tokens to the maker, maker needs to have an associated token account
    /// usallay created when initializing the order but if they close we create it
    /// take samll amount from the making amount and swap it wSOL and send it to the payer
    /// payer create the ATA
    #[instruction(discriminator = [0])]
    pub fn create_ata<'info>(
        ctx: Context<'_, '_, '_, 'info, CreateToken<'info>>,
        args: CreateTokenAccountArgs,
    ) -> Result<()> {
        create_token_account::create_token_account(ctx, args)
    }

    /// If the making tokens is WSOL then no need to swap
    /// take small amount from it and send it payer
    /// payer create the output ATA.
    /// update's the amount state. sub both making and taking amount
    #[instruction(discriminator = [1])]
    pub fn create_ata_wsol<'info>(
        ctx: Context<'_, '_, '_, 'info, CreateTokenWsol<'info>>,
        args: CreateTokenAccountWsolArgs,
    ) -> Result<()> {
        create_ata_wsol::create_token_account(ctx, args)
    }

    /// fill the order when the price reaches the user target
    /// this instruction will be called by a worker that is monitoring the price
    /// swap's the token in vault using jupiter cpi
    /// close or update the light compressed escrow account
    /// transfer the output tokens to the maker
    #[instruction(discriminator = [2])]
    pub fn fill_order<'info>(
        ctx: Context<'_, '_, '_, 'info, FillOrder<'info>>,
        args: FillOrderParams,
    ) -> Result<()> {
        fill_order::fill(ctx, args)
    }

    #[instruction(discriminator = [3])]
    pub fn fill_wsol_order<'info>(
        ctx: Context<'_, '_, '_, 'info, FillOrderWSol<'info>>,
        args: FillOrderParams,
    ) -> Result<()> {
        fill_wsol_order::fill(ctx, args)
    }

    /// Close empty protocol vault token accounts
    pub fn close_protocol_ata<'info>(
        ctx: Context<'_, '_, '_, 'info, CloseProtocolAta<'info>>,
    ) -> Result<()> {
        close_protocol_ata::close_protocol_ata(ctx)
    }
}

pub fn swap_cpi<'info>(
    swap_data: &[u8],
    accounts: &[AccountInfo<'info>],
    protocol_vault: &AccountInfo<'info>,
    jupiter_program: &AccountInfo<'info>,
) -> Result<()> {
    let account_metas: Vec<AccountMeta> = accounts
        .iter()
        .map(|acc| {
            let is_signer = acc.key == &protocol_vault.key();
            AccountMeta {
                pubkey: *acc.key,
                is_signer,
                is_writable: acc.is_writable,
            }
        })
        .collect();

    let signer_seeds: &[&[&[u8]]] = &[&[PROTOCOL_VAULT_SEED, &[PROTOCOL_VAULT_BUMP]]];

    require_keys_eq!(
        jupiter_program.key(),
        JUPITER_V6_PROGRAM_ID,
        CustomError::InvalidAccount
    );

    invoke_signed(
        &Instruction {
            program_id: jupiter_program.key(),
            accounts: account_metas,
            data: swap_data.to_vec(),
        },
        accounts,
        signer_seeds,
    )?;

    Ok(())
}

#[derive(Debug)]
pub struct RouteData {
    pub in_amount: u64,
    pub out_amount: u64,
    pub slippage_bps: u16,
    pub platform_fee_bps: u8,
    pub is_exact_out: bool,
    pub route: JupiterRoutes,
}

pub fn parse_jupiter_route_data(data: &[u8]) -> Result<RouteData> {
    if data.len() < 8 {
        return Err(error!(CustomError::InvalidJupInstructionData));
    }

    let discriminator = &data[0..8];
    let mut input_data = &data[8..];

    if discriminator == discriminators::EXACT_OUT_ROUTE {
        let route_data = ExactOutRoute::deserialize(&mut input_data)?;
        Ok(RouteData {
            in_amount: route_data.quoted_in_amount,
            out_amount: route_data.out_amount,
            slippage_bps: route_data.slippage_bps,
            platform_fee_bps: route_data.platform_fee_bps,
            is_exact_out: true,
            route: JupiterRoutes::ExactOutRoute,
        })
    } else if discriminator == discriminators::SHARED_ACCOUNTS_EXACT_OUT_ROUTE {
        let route_data = SharedAccountsExactOutRoute::deserialize(&mut input_data)?;
        Ok(RouteData {
            in_amount: route_data.quoted_in_amount,
            out_amount: route_data.out_amount,
            slippage_bps: route_data.slippage_bps,
            platform_fee_bps: route_data.platform_fee_bps,
            is_exact_out: true,
            route: JupiterRoutes::SharedAccountsExactOutRoute,
        })
    } else if discriminator == discriminators::ROUTE {
        let route_data = Route::deserialize(&mut input_data)?;
        Ok(RouteData {
            in_amount: route_data.in_amount,
            out_amount: route_data.quoted_out_amount,
            slippage_bps: route_data.slippage_bps,
            platform_fee_bps: route_data.platform_fee_bps,
            is_exact_out: false,
            route: JupiterRoutes::Route,
        })
    } else if discriminator == discriminators::SHARED_ACCOUNTS_ROUTE {
        let route_data = SharedAccountsRoute::deserialize(&mut input_data)?;
        Ok(RouteData {
            in_amount: route_data.in_amount,
            out_amount: route_data.quoted_out_amount,
            slippage_bps: route_data.slippage_bps,
            platform_fee_bps: route_data.platform_fee_bps,
            is_exact_out: false,
            route: JupiterRoutes::SharedAccountsRoute,
        })
    } else {
        Err(error!(CustomError::InvalidJupInstructionData))
    }
}

// JUPITER ROUTE discriminators
pub mod discriminators {
    pub const EXACT_OUT_ROUTE: [u8; 8] = [208, 51, 239, 151, 123, 43, 237, 92];
    pub const ROUTE: [u8; 8] = [229, 23, 203, 151, 122, 227, 173, 42];
    pub const SHARED_ACCOUNTS_EXACT_OUT_ROUTE: [u8; 8] = [176, 209, 105, 168, 154, 125, 69, 62];
    pub const SHARED_ACCOUNTS_ROUTE: [u8; 8] = [193, 32, 155, 51, 65, 214, 156, 129];
}
