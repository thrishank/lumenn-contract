import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { Elara } from "../target/types/elara";
import IDL from "../target/idl/elara.json";
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";

import express from "express";
import { bn, createRpc } from "@lightprotocol/stateless.js";
import { parseEscrowFromBuffer } from "../tests/utils/fn";
import { determineFillType, get_price, get_swap_instruction } from "./jup";
import { create_token_ata } from "./instructions/create_ata";
import { fill, fill_wsol } from "./instructions/fill";
import { expire, expire_wsol } from "./instructions/expire";
import * as dotenv from "dotenv";
import {
  caluclate_target_ratio,
  errorHandler,
  logger,
  metrics,
  requestLogger,
  retryOperation,
} from "./utils";

dotenv.config();

if (!process.env.KEY) {
  logger.error("Missing required environment variable: KEY");
  process.exit(1);
}

const connection = new Connection("https://api.devnet.solana.com");

export let payer: Keypair;
try {
  const secret = JSON.parse(process.env.KEY!);
  payer = Keypair.fromSecretKey(Uint8Array.from(secret));
  logger.info("Payer initialized", { publicKey: payer.publicKey.toString() });
} catch (error) {
  logger.error("Failed to initialize payer keypair", {
    error: (error as Error).message,
  });
  process.exit(1);
}

const provider = new AnchorProvider(connection, new Wallet(payer), {});
export const program = new Program<Elara>(IDL as Elara, provider);

const url =
  "https://devnet.helius-rpc.com/?api-key=c991f045-ba1f-4d71-b872-0ef87e7f039d";

export const rpc = createRpc(url, url, url);

export const SOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);

const app = express();

app.use(requestLogger);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/health", async (req, res) => {
  try {
    // Quick health checks
    await Promise.race([
      connection.getSlot(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 5000)
      ),
    ]);

    const health = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      metrics,
    };

    res.json(health);
  } catch (error) {
    logger.error("Health check failed", { error: (error as Error).message });
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: (error as Error).message,
    });
  }
});

app.get("/metrics", (req, res) => {
  res.json({
    ...metrics,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get(
  "/fill",
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const { requestId, startTime } = res.locals;

    try {
      let { order } = req.query;

      logger.info("Fill request started", { requestId, order });

      if (!order) {
        throw new Error("Missing order parameter");
      }

      let address: PublicKey;
      try {
        address = new PublicKey(order as string);
      } catch (e) {
        throw new Error("Invalid order address - not a valid PublicKey");
      }

      const compressed_account = await retryOperation(
        () => rpc.getCompressedAccount(bn(address.toBytes())),
        3,
        1000,
        "getCompressedAccount"
      );

      if (!compressed_account?.data?.data) {
        throw new Error("Compressed account not found or has no data");
      }

      const buffer = compressed_account?.data?.data!;
      const escrow_data = parseEscrowFromBuffer(buffer);

      const expiredAt = escrow_data.expiredAt.toNumber() * 1000;

      const inputMint = escrow_data.tokens.inputMint;
      const outputMint = escrow_data.tokens.outputMint;

      logger.info("Escrow data parsed", {
        requestId,
        maker: escrow_data.maker.toString(),
        inputMint: inputMint.toString(),
        outputMint: outputMint.toString(),
        makingAmount: escrow_data.amount.makingAmount.toNumber(),
        takingAmount: escrow_data.amount.takingAmount.toNumber(),
        expiredAt: new Date(expiredAt).toISOString(),
      });

      if (expiredAt != 0 && expiredAt <= Date.now()) {
        throw new Error("Order has expired");
      }

      // This functions creates the ata if it doesn't exisit
      let ata_created = await create_token_ata(
        compressed_account,
        escrow_data,
        requestId
      );

      const { current_ratio } = await get_price(
        inputMint.toString(),
        outputMint.toString()
      );

      const target_ratio = await caluclate_target_ratio(
        escrow_data.amount.makingAmount.toNumber(),
        escrow_data.amount.takingAmount.toNumber(),
        inputMint.toString(),
        outputMint.toString()
      );

      if (Number(target_ratio) > current_ratio) {
        throw new Error(
          `Target Ratio: ${target_ratio} is greater than current market ratio: ${current_ratio} `
        );
      }

      const fill_data = await determineFillType(
        escrow_data,
        inputMint,
        outputMint
      );

      let finalInstructionData: any = null;
      let finalAccounts: any[] = [];
      let finalAlt: any[] = [];

      if (ata_created) {
        // NOTE:: this fetch call is to get the updated making amount. a few will be deducted in create ata
        const compressed_account = await rpc.getCompressedAccount(
          bn(address.toBytes())
        );

        const escrow_data = parseEscrowFromBuffer(compressed_account.data.data);
        const { instruction_data, accounts, alt } = await get_swap_instruction(
          inputMint.toString(),
          outputMint.toString(),
          escrow_data.amount.makingAmount
            .div(new BN(fill_data.divisor))
            .toNumber(),
          "ExactIn"
        );
        finalInstructionData = instruction_data;
        finalAccounts = accounts;
        finalAlt = alt;
      } else {
        finalInstructionData = fill_data.instruction_data;
        finalAccounts = fill_data.accounts;
        finalAlt = fill_data.accounts;
      }

      if (!finalInstructionData) {
        throw new Error("Swap Quote not found to fill the order");
      }

      let tx: VersionedTransaction;

      if (outputMint.equals(SOL_MINT)) {
        tx = await fill_wsol(
          address,
          fill_data.fill_type === "partial" ? "partial" : "full",
          finalInstructionData,
          finalAccounts,
          finalAlt
        );
      } else {
        tx = await fill(
          address,
          fill_data.fill_type === "partial" ? "partial" : "full",
          finalInstructionData,
          finalAccounts,
          finalAlt
        );
      }

      tx.sign([payer]);

      const sig = await rpc.sendTransaction(tx);
      const responseTime = performance.now() - startTime;

      metrics.successfulFills++;

      logger.info("Fill transaction successful", {
        requestId,
        sig,
        responseTime: `${responseTime.toFixed(2)}ms`,
        order: address.toString(),
        fillType: fill_data.fill_type,
      });
      return res.status(200).json({ sig });
    } catch (error) {
      metrics.failedFills++;
      next(error);
    }
  }
);

app.get(
  "/expired",
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const { requestId, startTime } = res.locals;
    try {
      let { order } = req.query;

      logger.info("Expire request started", { requestId, order });

      if (!order) {
        throw new Error("Missing order parameter");
      }

      let address: PublicKey;
      try {
        address = new PublicKey(order as string);
      } catch (e) {
        throw new Error("Invalid order address - not a valid PublicKey");
      }

      let compressed_account = await retryOperation(
        () => rpc.getCompressedAccount(bn(address.toBytes())),
        3,
        1000,
        "getCompressedAccount"
      );

      if (!compressed_account?.data?.data) {
        throw new Error("Compressed account not found or has no data");
      }

      const buffer = compressed_account?.data?.data!;

      const escrow_data = parseEscrowFromBuffer(buffer);

      logger.info("Escrow data for expiry", {
        requestId,
        maker: escrow_data.maker.toString(),
        expiredAt: new Date(
          escrow_data.expiredAt.toNumber() * 1000
        ).toISOString(),
        isExpired: escrow_data.expiredAt.toNumber() <= Date.now(),
      });

      if (escrow_data.expiredAt.toNumber() * 1000 > Date.now()) {
        const timeUntilExpiry =
          escrow_data.expiredAt.toNumber() * 1000 - Date.now();
        throw new Error(
          `Escrow not expired yet. Time remaining: ${Math.floor(
            timeUntilExpiry / 1000
          )}s`
        );
      }

      await create_token_ata(compressed_account, escrow_data, requestId);

      let tx: VersionedTransaction;

      if (escrow_data.tokens.inputMint.equals(SOL_MINT)) {
        tx = await expire_wsol(address);
      } else {
        tx = await expire(address);
      }

      tx.sign([payer]);

      const signature = await rpc.sendTransaction(tx);

      const responseTime = performance.now() - startTime;

      metrics.successfulExpires++;

      logger.info("Expire transaction successful", {
        requestId,
        signature,
        responseTime: `${responseTime.toFixed(2)}ms`,
        order: address.toString(),
      });

      return res.status(200).json({ signature });
    } catch (error) {
      metrics.failedExpires++;
      next(error);
    }
  }
);

app.use(errorHandler);

const gracefulShutdown = (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully`);
  process.exit(0);
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// Log unhandled errors
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Promise Rejection", { reason, promise });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

const server = app.listen(4000, "127.0.0.1", () => {
  logger.info("Elara Trading Server started", {
    port: 4000,
    environment: process.env.NODE_ENV || "development",
    nodeVersion: process.version,
  });
});

server.on("error", (error) => {
  logger.error("Server error", { error: error.message });
});
