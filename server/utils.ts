import fs from "fs";
import path from "path";
import express from "express";
import winston from "winston";
import tokensData from "./../tokens.json";
import { VersionedTransaction } from "@solana/web3.js";
import { rpc } from "./app";

const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length
        ? " | " + JSON.stringify(meta)
        : "";
      return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length
            ? " | " + JSON.stringify(meta, null, 2)
            : "";
          return `${timestamp} [${level}] ${message}${metaStr}`;
        })
      ),
    }),
    new winston.transports.File({
      filename: path.join(logsDir, "app.log"),
      format: winston.format.json(),
      maxsize: 5242880, // 5MB
      maxFiles: 3,
    }),
  ],
});

interface Metrics {
  totalRequests: number;
  successfulFills: number;
  failedFills: number;
  successfulExpires: number;
  failedExpires: number;
  averageResponseTime: number;
  lastActivity: string;
}

export const metrics: Metrics = {
  totalRequests: 0,
  successfulFills: 0,
  failedFills: 0,
  successfulExpires: 0,
  failedExpires: 0,
  averageResponseTime: 0,
  lastActivity: new Date().toISOString(),
};

// Request logging middleware
export const requestLogger = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const startTime = performance.now();
  const requestId = Math.random().toString(36).substring(7);

  res.locals.requestId = requestId;
  res.locals.startTime = startTime;

  logger.info("Request received", {
    requestId,
    method: req.method,
    path: req.path,
    query: req.query,
  });

  res.on("finish", () => {
    const responseTime = performance.now() - startTime;
    metrics.totalRequests++;
    metrics.averageResponseTime =
      (metrics.averageResponseTime + responseTime) / 2;
    metrics.lastActivity = new Date().toISOString();

    logger.info("Request completed", {
      requestId,
      statusCode: res.statusCode,
      responseTime: `${responseTime.toFixed(2)}ms`,
    });
  });

  next();
};

export const errorHandler = (
  error: any,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const requestId = res.locals.requestId;
  const responseTime = performance.now() - res.locals.startTime;

  logger.error("Request failed", {
    requestId,
    error: error.message,
    stack: error.stack,
    path: req.path,
    query: req.query,
    responseTime: `${responseTime.toFixed(2)}ms`,
  });

  // Return appropriate status code
  let statusCode = 500;
  if (error.message.includes("Invalid") || error.message.includes("Missing")) {
    statusCode = 400;
  } else if (
    error.message.includes("not found") ||
    error.message.includes("not exist")
  ) {
    statusCode = 404;
  } else if (error.message.includes("expired")) {
    statusCode = 410; // Gone - for expired orders
  } else if (error.message.includes("timeout")) {
    statusCode = 504; // Gateway timeout
  }

  if (!res.headersSent) {
    res.status(statusCode).json({
      error: error.message,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
};

export const retryOperation = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000,
  operationName: string = "operation"
): Promise<T> => {
  let lastError: Error;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      const isLastAttempt = i === maxRetries - 1;

      if (isLastAttempt) {
        logger.error(`${operationName} failed after ${maxRetries} attempts`, {
          error: lastError.message,
        });
        throw lastError;
      }

      logger.warn(`${operationName} failed, retrying`, {
        attempt: i + 1,
        maxRetries,
        error: lastError.message,
      });

      await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
    }
  }

  // This should never be reached, but TypeScript requires it
  throw lastError!;
};

interface Token {
  id: string;
  name: string;
  symbol: string;
  icon?: string;
  decimals: number;
  tokenProgram: string;
}

const tokens: Token[] = tokensData;

export const tokenMap: Map<string, Token> = new Map(
  tokens.map((t) => [t.id, t])
);

export async function caluclate_target_ratio(
  making_amount: number,
  taking_amount: number,
  making_token: string,
  taking_token: string
) {
  let takingToken = tokenMap.get(taking_token);
  let makingToken = tokenMap.get(making_token);

  if (!takingToken) {
    takingToken = await fetch_token_data(taking_token);
  }
  if (!makingToken) {
    makingToken = await fetch_token_data(making_token);
  }

  const taking = taking_amount / 10 ** takingToken.decimals;
  const making = making_amount / 10 ** makingToken.decimals;

  return taking / making;
}

async function fetch_token_data(mint: string) {
  const cached = tokenMap.get(mint);
  if (cached) return cached;

  // Fetch from Jupiter API
  const url = `https://lite-api.jup.ag/tokens/v2/search?query=${mint}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`Token not found on Jupiter: ${mint}`);
  }

  const token: Token = {
    id: data[0].id,
    name: data[0].name,
    symbol: data[0].symbol,
    icon: data[0].icon,
    decimals: data[0].decimals,
    tokenProgram: data[0].tokenProgram,
  };

  tokens.push(token);
  tokenMap.set(token.id, token);

  return token;
}

export async function getComputeUnitsUsed(
  tx: VersionedTransaction
): Promise<number> {
  const sim = await rpc.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });

  console.log("simulation", sim);

  if (sim.value.err) {
    throw new Error("Simulation failed: " + JSON.stringify(sim.value.err));
  }

  const unitsConsumed = sim.value.unitsConsumed ?? 0;
  if (unitsConsumed > 1_380_000) {
    return unitsConsumed;
  }
  return unitsConsumed + 10_000;
}
