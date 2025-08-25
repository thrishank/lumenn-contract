import { PublicKey } from "@solana/web3.js";

export const pubkey = (key: string) => new PublicKey(key);

// Static Public Keys
export const STATE_TREE = pubkey("smt6ukQDSPPYHSshQovmiRUjG9jGFq2hW9vgrDFk5Yz");
export const STATE_QUEUE = pubkey(
  "nfq6uzaNZ5n3EWF4t64M93AWzLGt5dXTikEA9fFRktv"
);
export const ADDRESS_TREE = pubkey(
  "amt1Ayt45jfbdw5YSo7iz6WZxUmnZsQTYXy82hVwyC2"
);
export const ADDRESS_QUEUE = pubkey(
  "aq1S9z4reTSQAdgWHGD2zDaS39sjGrAxbR31vxJ2F4F"
);
export const PROGRAM_ID = pubkey(
  "4LhEEtzAhM6wEXJR2YQHPEs79UEx8e6HncmeHbqbW1w1"
);
export const COMPRESSION_PROGRAM = pubkey(
  "compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq"
);
export const REGISTERED_PROGRAM_PDA = pubkey(
  "35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh"
);
export const ACCOUNT_COMPRESSION_AUTHORITY = pubkey(
  "HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA"
);
export const NOOP_PROGRAM = pubkey(
  "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV"
);
export const SYSTEM_PROGRAM = pubkey("11111111111111111111111111111111");
export const LIGHT_SYSTEM_PROGRAM = pubkey(
  "SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7"
);

export const COMPUTE_BUDGET_PROGRAM = pubkey(
  "ComputeBudget111111111111111111111111111111"
);

export const ASSOCIATED_TOKEN_PROGRAM = pubkey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

// Derived PDAs
export const [CPI_AUTHORITY] = PublicKey.findProgramAddressSync(
  [Buffer.from("cpi_authority")],
  PROGRAM_ID
);

export const INIT_REMAINING_ACCOUNTS = [
  {
    pubkey: LIGHT_SYSTEM_PROGRAM,
    isSigner: false,
    isWritable: false,
  },
  { pubkey: CPI_AUTHORITY, isSigner: false, isWritable: false },
  {
    pubkey: REGISTERED_PROGRAM_PDA,
    isSigner: false,
    isWritable: false,
  },
  { pubkey: NOOP_PROGRAM, isSigner: false, isWritable: false },
  {
    pubkey: ACCOUNT_COMPRESSION_AUTHORITY,
    isSigner: false,
    isWritable: false,
  },
  { pubkey: COMPRESSION_PROGRAM, isSigner: false, isWritable: false },
  { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
  { pubkey: ADDRESS_TREE, isSigner: false, isWritable: true },
  { pubkey: STATE_TREE, isSigner: false, isWritable: true },
  { pubkey: ADDRESS_QUEUE, isSigner: false, isWritable: true },
];

export const CLOSE_ACCOUNTS = [
  { pubkey: LIGHT_SYSTEM_PROGRAM, isSigner: false, isWritable: false },
  { pubkey: CPI_AUTHORITY, isSigner: false, isWritable: false },
  { pubkey: REGISTERED_PROGRAM_PDA, isSigner: false, isWritable: false },
  { pubkey: NOOP_PROGRAM, isSigner: false, isWritable: false },
  {
    pubkey: ACCOUNT_COMPRESSION_AUTHORITY,
    isSigner: false,
    isWritable: false,
  },
  { pubkey: COMPRESSION_PROGRAM, isSigner: false, isWritable: false },
  { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
  { pubkey: STATE_TREE, isSigner: false, isWritable: true },
  { pubkey: STATE_QUEUE, isSigner: false, isWritable: true },
];
