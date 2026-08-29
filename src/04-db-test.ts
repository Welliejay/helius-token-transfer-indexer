import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

interface TransferRow {
  transferId: string;
  signature: string;
  instructionLocation: string;
  slot: number;
  blockTime: string;
  tokenProgram: "spl-token" | "token-2022";
  mint: string;
  sourceTokenAccount: string;
  destinationTokenAccount: string;
  authority: string | null;
  rawAmount: string;
  decimals: number;
}

const schemaPath = new URL("../sql/schema.sql", import.meta.url);
const schema = await readFile(schemaPath, "utf8");
const db = new PGlite();

const firstTransfer: TransferRow = {
  transferId: "fixture-signature-001:top:1",
  signature: "fixture-signature-001",
  instructionLocation: "top:1",
  slot: 442_194_269,
  blockTime: "2026-08-27T21:45:22.000Z",
  tokenProgram: "spl-token",
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  sourceTokenAccount: "classic-source-a",
  destinationTokenAccount: "classic-destination-a",
  authority: "classic-owner-a",
  rawAmount: "1500000",
  decimals: 6,
};

const secondTransfer: TransferRow = {
  ...firstTransfer,
  transferId: "fixture-signature-001:inner:1:0",
  instructionLocation: "inner:1:0",
  destinationTokenAccount: "classic-destination-b",
  rawAmount: "250000",
};

const insertSql = `
  INSERT INTO token_transfers (
    transfer_id,
    signature,
    instruction_location,
    slot,
    block_time,
    token_program,
    mint,
    source_token_account,
    destination_token_account,
    authority,
    raw_amount,
    decimals
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT (signature, instruction_location) DO NOTHING
  RETURNING transfer_id
`;

async function insertTransfer(transfer: TransferRow): Promise<number> {
  const result = await db.query<{ transfer_id: string }>(insertSql, [
    transfer.transferId,
    transfer.signature,
    transfer.instructionLocation,
    transfer.slot,
    transfer.blockTime,
    transfer.tokenProgram,
    transfer.mint,
    transfer.sourceTokenAccount,
    transfer.destinationTokenAccount,
    transfer.authority,
    transfer.rawAmount,
    transfer.decimals,
  ]);

  return result.rows.length;
}

try {
  await db.exec(schema);

  const firstInsertCount = await insertTransfer(firstTransfer);
  const duplicateInsertCount = await insertTransfer(firstTransfer);
  const secondLocationInsertCount = await insertTransfer(secondTransfer);

  const countResult = await db.query<{ row_count: number }>(`
    SELECT COUNT(*)::INTEGER AS row_count
    FROM token_transfers
  `);
  const storedRowCount = countResult.rows[0]?.row_count;

  assert.equal(firstInsertCount, 1);
  assert.equal(duplicateInsertCount, 0);
  assert.equal(secondLocationInsertCount, 1);
  assert.equal(storedRowCount, 2);

  console.log("PostgreSQL idempotency test succeeded.");
  console.log(`First insert rows: ${firstInsertCount}`);
  console.log(`Duplicate insert rows: ${duplicateInsertCount}`);
  console.log(`Same signature, new location rows: ${secondLocationInsertCount}`);
  console.log(`Final stored rows: ${storedRowCount}`);
} finally {
  await db.close();
}
