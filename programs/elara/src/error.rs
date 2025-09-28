use anchor_lang::prelude::*;

#[error_code]
pub enum CustomError {
    #[msg("Invalid escrow owner: the escrow must be owned by the program ID")]
    InvalidEscrowOwner,

    #[msg("Unauthorized: invalid signer")]
    Unauthorized,

    #[msg("Invalid input mint")]
    InvalidInputMint,

    #[msg("Invalid output mint")]
    InvalidOutputMint,

    #[msg("Invalid token account")]
    InvalidTokenAccount,

    #[msg("Invalid output amount: exactly 2,039,280 lamports required to create a token account")]
    InvalidOutAmount,

    #[msg("Token account already exists")]
    TokenAccountAlreadyExists,

    #[msg("Invalid Jupiter instruction data. Data length is less than 8 or is an exact-out route or shared-accounts exact-out route")]
    InvalidJupInstructionData,

    #[msg("Invalid input amount: must match the escrow account's making amount")]
    InvalidInAmount,

    #[msg("Taking amount too low")]
    LowTakingAmount,

    #[msg("Invalid escrow maker: must match the escrow account maker")]
    InvalidEscrowMaker,

    #[msg("Slippage too high")]
    SlippageTooHigh,

    #[msg("Invalid amount: must be greater than 0")]
    InvalidAmount,

    #[msg("Invalid slippage: must be ≤ 10,000 BPS")]
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

    #[msg("Invalid platform fee BPS: must be either 0 or 10")]
    InvalidPlatformFeeBps,

    #[msg("Invalid instruction: to create an ATA for SOL, call `create_ata_wsol` instead")]
    InvalidCreateAtaInstruction,

    #[msg("Invalid token program ID")]
    InvalidTokenProgramId,

    #[msg("Invalid account")]
    InvalidAccount,

    #[msg("Account is not writable")]
    NotWritable,

    #[msg("Invalid number of accounts")]
    InvalidNumberOfAccounts,

    #[msg("SOL ATA must be created separately")]
    SolAtaCreatedSeparately,

    #[msg("Order has not expired")]
    OrderNotExpired,

    #[msg("Must call `expire_wsol` instruction")]
    ExpireWSolInstruction,

    #[msg(
        "Invalid fee token account in jupiter accounts. The fee account must be ata of input_mint"
    )]
    InvalidFeeAccount,

    #[msg("Token account is not empty")]
    TokenAccountNotEmpty,

    #[msg("Mekle Tree pubkey is invalid")]
    InvalidMerkleTreePubkey,
}
