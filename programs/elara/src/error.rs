use anchor_lang::prelude::*;

#[error_code]
pub enum CustomError {
    #[msg("Invalid escrow owner. The owner of the esrow must be program ID")]
    InvalidEscrowOwner,
    #[msg("Invalid signer")]
    Unauthorized,
    #[msg("invalid input mint")]
    InvalidInputMint,
    #[msg("invalid output mint")]
    InvalidOutputMint,
    #[msg("invalid token account passed")]
    InvalidTokenAccount,
    #[msg("Invalid out amount need exact 2039280 lamports to create token account")]
    InvalidOutAmount,
    #[msg("Token Account already exsits")]
    TokenAccountAlreadyExists,
    #[msg("Invalid instruction data from jupiter must be a exact out route or shared accounts exact out route")]
    InvalidJupInstructionData,
    #[msg("Invalid in amount, must match the escrow account making amount")]
    InvalidInAmount,
    #[msg("Out taking amount too low")]
    LowTakingAmount,
    #[msg("Invalid escrow maker, must be the same as the escrow account maker")]
    InvalidEscrowMaker,
    #[msg("Slipppage too high")]
    SlippageTooHigh,
    #[msg("Invalid amount: must be greater than 0")]
    InvalidAmount,
    #[msg("Invalid slippage: must be <= 10000 BPS")]
    InvalidSlippage,
    #[msg("Invalid expiration: must be in the future")]
    InvalidExpiration,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Input and output mints cannot be the same")]
    SameMints,
    #[msg("Invalid mint configuration")]
    InvalidMint,
    #[msg("Order already exists")]
    OrderAlreadyExists,
    #[msg("Amount too large for safe calculations")]
    AmountTooLarge,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid escrow address")]
    InvalidEscrow,
    #[msg("Invalid platform fee bps should be either 5 or 0")]
    InvalidPlatformFeeBps,
}
