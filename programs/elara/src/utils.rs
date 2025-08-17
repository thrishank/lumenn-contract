use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id, token::spl_token,
    token_2022::spl_token_2022,
};

use crate::{
    error::CustomError, instructions::JupiterRoutes, JUPITER_EVENT_AUTHORITY,
    JUPITER_V6_PROGRAM_ID, PROTOCOL_VAULT,
};

#[inline]
pub fn validate_jupiter_accounts(
    route: &JupiterRoutes,
    jupiter_accounts: &[AccountInfo],
    input_mint: Pubkey,
    output_mint: Pubkey,
    input_token_program: Pubkey,
    output_token_program: Pubkey,
) -> Result<()> {
    match route {
        JupiterRoutes::ExactOutRoute => validate_exact_out_route(
            jupiter_accounts,
            input_mint,
            output_mint,
            input_token_program,
            output_token_program,
        ),
        JupiterRoutes::Route => validate_route(
            jupiter_accounts,
            input_mint,
            output_mint,
            input_token_program,
            output_token_program,
        ),
        JupiterRoutes::SharedAccountsExactOutRoute | JupiterRoutes::SharedAccountsRoute => {
            validate_shared_accounts_route(
                jupiter_accounts,
                input_mint,
                output_mint,
                input_token_program,
                output_token_program,
            )
        }
    }
}

fn validate_exact_out_route(
    jup_accounts: &[AccountInfo],
    input_mint: Pubkey,
    ouput_mint: Pubkey,
    input_token_program: Pubkey,
    output_token_program: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        jup_accounts[0].key(),
        spl_token::ID.key(),
        CustomError::InvalidTokenProgramId
    );

    require_keys_eq!(
        jup_accounts[1].key(),
        PROTOCOL_VAULT,
        CustomError::InvalidAccount
    );

    let source_token_account = get_associated_token_address_with_program_id(
        &PROTOCOL_VAULT,
        &input_mint,
        &input_token_program,
    );

    require_keys_eq!(
        jup_accounts[2].key(),
        source_token_account.key(),
        CustomError::InvalidTokenAccount
    );

    require!(jup_accounts[2].is_writable, CustomError::NotWritable);

    let destination_token_account = get_associated_token_address_with_program_id(
        &PROTOCOL_VAULT,
        &ouput_mint,
        &output_token_program,
    );

    require_keys_eq!(
        jup_accounts[3].key(),
        destination_token_account.key(),
        CustomError::InvalidTokenAccount
    );

    require!(jup_accounts[3].is_writable, CustomError::NotWritable);

    // 4 destination_token_account

    require_keys_eq!(
        jup_accounts[5].key(),
        input_mint,
        CustomError::InvalidInputMint
    );

    require_keys_eq!(
        jup_accounts[6].key(),
        ouput_mint,
        CustomError::InvalidOutputMint
    );

    // 7 platform fee_account

    require_keys_eq!(
        jup_accounts[8].key(),
        spl_token_2022::ID,
        CustomError::InvalidTokenProgramId
    );

    require_keys_eq!(
        jup_accounts[9].key(),
        JUPITER_EVENT_AUTHORITY,
        CustomError::InvalidAccount
    );

    require_keys_eq!(
        jup_accounts[10].key(),
        JUPITER_V6_PROGRAM_ID,
        CustomError::InvalidTokenProgramId
    );

    Ok(())
}

fn validate_route(
    jup_accounts: &[AccountInfo],
    input_mint: Pubkey,
    ouput_mint: Pubkey,
    input_token_program: Pubkey,
    output_token_program: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        jup_accounts[0].key(),
        spl_token::ID.key(),
        CustomError::InvalidTokenProgramId
    );

    require_keys_eq!(
        jup_accounts[1].key(),
        PROTOCOL_VAULT,
        CustomError::InvalidAccount
    );

    let source_token_account = get_associated_token_address_with_program_id(
        &PROTOCOL_VAULT,
        &input_mint,
        &input_token_program,
    );

    require_keys_eq!(
        jup_accounts[2].key(),
        source_token_account.key(),
        CustomError::InvalidTokenAccount
    );

    require!(jup_accounts[2].is_writable, CustomError::NotWritable);

    let destination_token_account = get_associated_token_address_with_program_id(
        &PROTOCOL_VAULT,
        &ouput_mint,
        &output_token_program,
    );

    require_keys_eq!(
        jup_accounts[3].key(),
        destination_token_account.key(),
        CustomError::InvalidTokenAccount
    );

    require!(jup_accounts[3].is_writable, CustomError::NotWritable);

    // 4 destination_token_account -> Jupiter program

    require_keys_eq!(
        jup_accounts[5].key(),
        ouput_mint,
        CustomError::InvalidOutputMint
    );

    // 6 platform fee_account

    require_keys_eq!(
        jup_accounts[7].key(),
        JUPITER_EVENT_AUTHORITY,
        CustomError::InvalidAccount
    );

    require_keys_eq!(
        jup_accounts[8].key(),
        JUPITER_V6_PROGRAM_ID,
        CustomError::InvalidTokenProgramId
    );

    Ok(())
}

fn validate_shared_accounts_route(
    jup_accounts: &[AccountInfo],
    input_mint: Pubkey,
    ouput_mint: Pubkey,
    input_token_program: Pubkey,
    output_token_program: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        jup_accounts[0].key(),
        spl_token::ID,
        CustomError::InvalidTokenProgramId
    );

    require_keys_eq!(
        jup_accounts[2].key(),
        PROTOCOL_VAULT,
        CustomError::InvalidAccount
    );

    let source_token_account = get_associated_token_address_with_program_id(
        &PROTOCOL_VAULT,
        &input_mint,
        &input_token_program,
    );

    require_keys_eq!(
        jup_accounts[3].key(),
        source_token_account.key(),
        CustomError::InvalidTokenAccount
    );

    require!(jup_accounts[3].is_writable, CustomError::NotWritable);

    let program_authority = jup_accounts[1].key();

    let program_source_token_account = get_associated_token_address_with_program_id(
        &program_authority,
        &input_mint,
        &input_token_program,
    );

    require_keys_eq!(
        jup_accounts[4].key(),
        program_source_token_account.key(),
        CustomError::InvalidTokenAccount
    );

    require!(jup_accounts[4].is_writable, CustomError::NotWritable);

    let program_destination_token_account = get_associated_token_address_with_program_id(
        &program_authority,
        &ouput_mint,
        &output_token_program,
    );

    require_keys_eq!(
        jup_accounts[5].key(),
        program_destination_token_account.key(),
        CustomError::InvalidTokenAccount
    );

    require!(jup_accounts[5].is_writable, CustomError::NotWritable);

    let destination_token_account = get_associated_token_address_with_program_id(
        &PROTOCOL_VAULT,
        &ouput_mint,
        &output_token_program,
    );

    require_keys_eq!(
        jup_accounts[6].key(),
        destination_token_account.key(),
        CustomError::InvalidTokenAccount
    );

    require!(jup_accounts[6].is_writable, CustomError::NotWritable);

    require_keys_eq!(
        jup_accounts[7].key(),
        input_mint,
        CustomError::InvalidInputMint
    );

    require_keys_eq!(
        jup_accounts[8].key(),
        ouput_mint,
        CustomError::InvalidOutputMint
    );

    // 9 platform fee_account

    require_keys_eq!(
        jup_accounts[10].key(),
        spl_token_2022::ID,
        CustomError::InvalidTokenProgramId
    );

    require_keys_eq!(
        jup_accounts[11].key(),
        JUPITER_EVENT_AUTHORITY,
        CustomError::InvalidAccount
    );

    require_keys_eq!(
        jup_accounts[12].key(),
        JUPITER_V6_PROGRAM_ID,
        CustomError::InvalidTokenProgramId
    );

    Ok(())
}
