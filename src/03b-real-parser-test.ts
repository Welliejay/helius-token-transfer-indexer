import assert from "node:assert/strict";
import "dotenv/config";
import { Connection } from "@solana/web3.js";
import { adaptHeliusParsedTransaction } from "./helius-parsed-transaction-adapter.js";
import {
  parseTokenTransfers,
  SPL_TOKEN_PROGRAM_ID,
} from "./token-transfer-parser.js";

const SIGNATURE =
  "49xD2hANitF3u3nPkTxsXLSL7TRx2W1tUFSEyjqKAusCTJYx1MuyacWhXjj9mg2FySboWvAQdufKWB2kKUSiQvcc";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const EXPECTED_LOCATION = "top:3";

function getApiKey(): string {
  const value = process.env.HELIUS_API_KEY?.trim();

  if (!value || value === "replace_with_your_helius_api_key") {
    console.error(
      "Missing HELIUS_API_KEY. Copy .env.example to .env and add your Helius API key.",
    );
    process.exit(1);
  }

  return value;
}

const apiKey = getApiKey();
const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`;

function redactApiKey(message: string): string {
  return message
    .replaceAll(apiKey, "[REDACTED]")
    .replaceAll(encodeURIComponent(apiKey), "[REDACTED]");
}

async function main(): Promise<void> {
  const connection = new Connection(rpcUrl, { commitment: "finalized" });
  const response = await connection.getParsedTransaction(SIGNATURE, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });

  assert.ok(response, "Expected Helius to return the finalized transaction");
  assert.equal(response.meta?.err, null, "Expected a successful transaction");

  const parserInput = adaptHeliusParsedTransaction(response);
  const result = parseTokenTransfers(parserInput, USDC_MINT);
  const expectedTransfer = result.transfers.find(
    (transfer) => transfer.instructionLocation === EXPECTED_LOCATION,
  );

  assert.equal(result.issues.length, 0);
  assert.ok(expectedTransfer, `Expected a transfer at ${EXPECTED_LOCATION}`);
  assert.equal(expectedTransfer.signature, SIGNATURE);
  assert.equal(expectedTransfer.mint, USDC_MINT);
  assert.equal(expectedTransfer.programId, SPL_TOKEN_PROGRAM_ID);
  assert.equal(expectedTransfer.tokenProgram, "spl-token");
  assert.equal(
    expectedTransfer.id,
    `${SIGNATURE}:${EXPECTED_LOCATION}`,
  );

  console.log("Real Helius transaction parser test succeeded.");
  console.log(`Slot: ${response.slot}`);
  console.log(`Signature: ${SIGNATURE}`);
  console.log(`USDC transfers matched: ${result.transfers.length}`);
  console.log(`Verified location: ${expectedTransfer.instructionLocation}`);
  console.log(`Raw amount: ${expectedTransfer.rawAmount}`);
  console.log(`Decimals: ${expectedTransfer.decimals}`);
  console.log(`Stable ID: ${expectedTransfer.id}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Real parser test failed: ${redactApiKey(message)}`);
  process.exitCode = 1;
});
