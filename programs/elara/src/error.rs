use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Custom error message")]
    CustomError,
    #[msg("Invalid signer")]
    Unauthorized,
    #[msg("invalid input mint")]
    InvalidInputMint,
}
