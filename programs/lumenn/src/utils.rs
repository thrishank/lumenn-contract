use crate::{
    error::CustomError, instructions::JupiterRoutes, JUPITER_EVENT_AUTHORITY,
    JUPITER_V6_PROGRAM_ID, PROTOCOL_VAULT,
};
use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id, token::spl_token,
};

pub fn validate_jupiter_accounts(
    route: &JupiterRoutes,
    jupiter_accounts: &[AccountInfo],
    input_mint: Pubkey,
    output_mint: Pubkey,
    input_token_program: Pubkey,
    output_token_program: Pubkey,
    fee_account: Option<Pubkey>,
) -> Result<()> {
    match route {
        JupiterRoutes::ExactOutRoute => validate_exact_out_route(
            jupiter_accounts,
            input_mint,
            output_mint,
            input_token_program,
            output_token_program,
            fee_account,
        ),
        JupiterRoutes::Route => validate_route(
            jupiter_accounts,
            input_mint,
            output_mint,
            input_token_program,
            output_token_program,
            fee_account,
        ),
        JupiterRoutes::SharedAccountsExactOutRoute | JupiterRoutes::SharedAccountsRoute => {
            validate_shared_accounts_route(
                jupiter_accounts,
                input_mint,
                output_mint,
                input_token_program,
                output_token_program,
                fee_account,
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
    fee_account: Option<Pubkey>,
) -> Result<()> {
    require!(
        jup_accounts[0].key() == spl_token::ID || jup_accounts[0].key() == spl_token_2022::ID,
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

    if let Some(fee_account) = fee_account {
        let fee_ata = get_associated_token_address_with_program_id(
            &fee_account,
            &input_mint,
            &input_token_program,
        );

        require_keys_eq!(
            jup_accounts[7].key(),
            fee_ata,
            CustomError::InvalidFeeAccount
        );
    } else {
        require_keys_eq!(
            jup_accounts[7].key(),
            JUPITER_V6_PROGRAM_ID,
            CustomError::InvalidFeeAccount
        );
    }

    if input_token_program == spl_token_2022::ID {
        require_keys_eq!(
            jup_accounts[8].key(),
            spl_token_2022::ID,
            CustomError::InvalidTokenProgramId
        );
    } else {
        require_keys_eq!(
            jup_accounts[8].key(),
            JUPITER_V6_PROGRAM_ID,
            CustomError::InvalidTokenProgramId
        );
    }

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
    fee_account: Option<Pubkey>,
) -> Result<()> {
    require!(
        jup_accounts[0].key() == spl_token::ID || jup_accounts[0].key() == spl_token_2022::ID,
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

    if let Some(fee_account) = fee_account {
        let fee_ata = get_associated_token_address_with_program_id(
            &fee_account,
            &input_mint,
            &input_token_program,
        );

        require_keys_eq!(
            jup_accounts[6].key(),
            fee_ata,
            CustomError::InvalidFeeAccount
        );
    } else {
        require_keys_eq!(
            jup_accounts[6].key(),
            JUPITER_V6_PROGRAM_ID,
            CustomError::InvalidFeeAccount
        );
    }

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
    fee_account: Option<Pubkey>,
) -> Result<()> {
    require!(
        jup_accounts[0].key() == spl_token::ID || jup_accounts[0].key() == spl_token_2022::ID,
        CustomError::InvalidTokenProgramId
    );

    // 1 Jupiter Aggregator Authority
    let program_authority = jup_accounts[1].key();

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

    let program_source_token_account = get_associated_token_address_with_program_id(
        &program_authority,
        &input_mint,
        &input_token_program,
    );

    require!(
        jup_accounts[4].key() == program_source_token_account.key()
            || jup_accounts[4].key() == source_token_account,
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

    if let Some(fee_account) = fee_account {
        let fee_ata = get_associated_token_address_with_program_id(
            &fee_account,
            &input_mint,
            &input_token_program,
        );

        require_keys_eq!(
            jup_accounts[9].key(),
            fee_ata,
            CustomError::InvalidFeeAccount
        );
    } else {
        require_keys_eq!(
            jup_accounts[9].key(),
            JUPITER_V6_PROGRAM_ID,
            CustomError::InvalidFeeAccount
        );
    }

    if input_token_program == spl_token_2022::ID || output_token_program == spl_token_2022::ID {
        require_keys_eq!(
            jup_accounts[10].key(),
            spl_token_2022::ID,
            CustomError::InvalidTokenProgramId
        );
    } else {
        require_keys_eq!(
            jup_accounts[10].key(),
            JUPITER_V6_PROGRAM_ID,
            CustomError::InvalidTokenProgramId
        );
    }

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

pub const STATE_TREE: Pubkey = pubkey!("smt6ukQDSPPYHSshQovmiRUjG9jGFq2hW9vgrDFk5Yz");
pub const STATE_QUEUE: Pubkey = pubkey!("nfq6uzaNZ5n3EWF4t64M93AWzLGt5dXTikEA9fFRktv");
pub const ADDRESS_TREE: Pubkey = pubkey!("amt1Ayt45jfbdw5YSo7iz6WZxUmnZsQTYXy82hVwyC2");
pub const ADDRESS_QUEUE: Pubkey = pubkey!("aq1S9z4reTSQAdgWHGD2zDaS39sjGrAxbR31vxJ2F4F");
pub const COMPRESSION_PROGRAM: Pubkey = pubkey!("compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq");
pub const REGISTERED_PROGRAM_PDA: Pubkey = pubkey!("35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh");
pub const ACCOUNT_COMPRESSION_AUTHORITY: Pubkey =
    pubkey!("HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA");
pub const NOOP_PROGRAM: Pubkey = pubkey!("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");
pub const SYSTEM_PROGRAM_ID: Pubkey = pubkey!("11111111111111111111111111111111");
pub const LIGHT_SYSTEM_PROGRAM: Pubkey = pubkey!("SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7");
pub const CPI_AUTHORITY: Pubkey = pubkey!("3odTzpE7FpCgYvFkQDWuNSyEhCeLkgpvMCB8Q3Nrj9T1");

pub enum LightAccountSet {
    Init,
    Update,
    Close,
}

fn base_accounts() -> Vec<AccountMeta> {
    vec![
        AccountMeta::new_readonly(LIGHT_SYSTEM_PROGRAM, false),
        AccountMeta::new_readonly(CPI_AUTHORITY, false),
        AccountMeta::new_readonly(REGISTERED_PROGRAM_PDA, false),
        AccountMeta::new_readonly(NOOP_PROGRAM, false),
        AccountMeta::new_readonly(ACCOUNT_COMPRESSION_AUTHORITY, false),
        AccountMeta::new_readonly(COMPRESSION_PROGRAM, false),
        AccountMeta::new_readonly(crate::ID, false),
        AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
    ]
}

pub fn expected_accounts(set: LightAccountSet) -> Vec<AccountMeta> {
    let mut accounts = base_accounts();
    match set {
        LightAccountSet::Init => {
            accounts.push(AccountMeta::new(ADDRESS_TREE, false));
            accounts.push(AccountMeta::new(STATE_TREE, false));
            accounts.push(AccountMeta::new(ADDRESS_QUEUE, false));
        }
        LightAccountSet::Update | LightAccountSet::Close => {
            accounts.push(AccountMeta::new(STATE_TREE, false));
            accounts.push(AccountMeta::new(STATE_QUEUE, false));
        }
    }

    accounts
}

pub fn validate_light_accounts(remaining: &[AccountInfo], expected: &[AccountMeta]) -> Result<()> {
    require_eq!(
        remaining.len(),
        expected.len(),
        CustomError::InvalidNumberOfAccounts
    );

    for (acc, exp) in remaining.iter().zip(expected.iter()) {
        require_keys_eq!(acc.key(), exp.pubkey, CustomError::InvalidAccount);

        // writable flag
        require!(acc.is_writable == exp.is_writable, CustomError::NotWritable);
    }

    Ok(())
}
