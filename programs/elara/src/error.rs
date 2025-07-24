use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Custom error message")]
    CustomError,
    #[msg("Invalid signer")]
    Unauthorized,
    #[msg("invalid input mint")]
    InvalidInputMint,
    #[msg("invalid token account passed")]
    InvalidTokenAccount,
    #[msg("Invalid out amount need exact 2039280 lamports to create token account")]
    InvalidOutAmount,
    #[msg("Token Account already exsits")]
    TokenAccountAlreadyExists,
    #[msg("Invalid instruction data from jupiter must be a exact out route or shared accounts exact out route")]
    InvalidJupInstructionData,
}
