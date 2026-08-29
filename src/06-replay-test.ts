import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

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

interface CheckpointRow {
  last_completed_slot: string | number | bigint;
}

interface CountRow {
  row_count: number;
  unique_transfer_ids: number;
}

const checkpointSource = "laserstream-token-transfers";
const startingCheckpoint = 1_000;
const schemaPath = new URL("../sql/schema.sql", import.meta.url);
const schema = await readFile(schemaPath, "utf8");

const baseTransfer: TransferRow = {
  transferId: "recovery-signature-a:top:0",
  signature: "recovery-signature-a",
  instructionLocation: "top:0",
  slot: 1_001,
  blockTime: "2026-08-28T12:00:00.000Z",
  tokenProgram: "spl-token",
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  sourceTokenAccount: "source-a",
  destinationTokenAccount: "destination-a",
  authority: "owner-a",
  rawAmount: "1000000",
  decimals: 6,
};

const sameSlotTransfer: TransferRow = {
  ...baseTransfer,
  transferId: "recovery-signature-b:inner:0:0",
  signature: "recovery-signature-b",
  instructionLocation: "inner:0:0",
  destinationTokenAccount: "destination-b",
  rawAmount: "250000",
};

const nextSlotTransfer: TransferRow = {
  ...baseTransfer,
  transferId: "recovery-signature-c:top:0",
  signature: "recovery-signature-c",
  slot: 1_002,
  destinationTokenAccount: "destination-c",
  rawAmount: "750000",
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

async function insertTransfer(
  client: PGlite | Transaction,
  transfer: TransferRow,
): Promise<number> {
  const result = await client.query<{ transfer_id: string }>(insertSql, [
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

async function readCheckpoint(db: PGlite): Promise<number> {
  const result = await db.query<CheckpointRow>(
    `
      SELECT last_completed_slot
      FROM ingestion_checkpoints
      WHERE source = $1
    `,
    [checkpointSource],
  );

  assert.equal(result.rows.length, 1, "The checkpoint row should exist");
  return Number(result.rows[0]?.last_completed_slot);
}

async function processCompletedSlot(
  db: PGlite,
  slot: number,
  transfers: TransferRow[],
): Promise<number[]> {
  return db.transaction(async (transaction) => {
    const insertCounts: number[] = [];

    for (const transfer of transfers) {
      insertCounts.push(await insertTransfer(transaction, transfer));
    }

    // This update commits atomically with all transfers for the completed slot.
    await transaction.query(
      `
        UPDATE ingestion_checkpoints
        SET last_completed_slot = $2, updated_at = NOW()
        WHERE source = $1
      `,
      [checkpointSource, slot],
    );

    return insertCounts;
  });
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "helius-replay-test-"));
const databaseDirectory = join(temporaryRoot, "pgdata");
let db: PGlite | null = null;

try {
  db = new PGlite(databaseDirectory);
  await db.exec(schema);
  await db.query(
    `
      INSERT INTO ingestion_checkpoints (source, last_completed_slot)
      VALUES ($1, $2)
    `,
    [checkpointSource, startingCheckpoint],
  );

  // Simulated failure window: one transfer is durable, but its slot is not yet
  // complete, so the checkpoint correctly remains at the older slot.
  const transferPersistedBeforeCrash = await insertTransfer(db, baseTransfer);
  const checkpointBeforeCrash = await readCheckpoint(db);
  await db.close();
  db = null;

  // A new PGlite instance represents a restarted process using the same disk data.
  db = new PGlite(databaseDirectory);
  const resumeFromSlot = await readCheckpoint(db);
  assert.equal(resumeFromSlot, startingCheckpoint);

  // Replay includes the already-written transfer. The unique key ignores it.
  const firstReplayCounts = await processCompletedSlot(db, 1_001, [
    baseTransfer,
    sameSlotTransfer,
  ]);
  const secondReplayCounts = await processCompletedSlot(db, 1_002, [
    nextSlotTransfer,
  ]);
  const allReplayCounts = [...firstReplayCounts, ...secondReplayCounts];
  const duplicateReplayRows = firstReplayCounts[0];
  const newReplayRows = allReplayCounts.reduce((sum, count) => sum + count, 0);

  await db.close();
  db = null;

  // Reopen once more to prove that both transfers and checkpoint survived restart.
  db = new PGlite(databaseDirectory);
  const checkpointAfterRecovery = await readCheckpoint(db);
  const countResult = await db.query<CountRow>(`
    SELECT
      COUNT(*)::INTEGER AS row_count,
      COUNT(DISTINCT transfer_id)::INTEGER AS unique_transfer_ids
    FROM token_transfers
  `);
  const finalStoredRows = countResult.rows[0]?.row_count;
  const uniqueTransferIds = countResult.rows[0]?.unique_transfer_ids;

  assert.equal(transferPersistedBeforeCrash, 1);
  assert.equal(checkpointBeforeCrash, startingCheckpoint);
  assert.equal(duplicateReplayRows, 0);
  assert.equal(newReplayRows, 2);
  assert.equal(checkpointAfterRecovery, 1_002);
  assert.equal(finalStoredRows, 3);
  assert.equal(uniqueTransferIds, 3);

  console.log("Recovery replay test succeeded.");
  console.log(`Checkpoint before crash: ${checkpointBeforeCrash}`);
  console.log(`Transfer persisted before crash: ${transferPersistedBeforeCrash}`);
  console.log(`Resume fromSlot: ${resumeFromSlot}`);
  console.log(`Rows inserted by duplicate replay: ${duplicateReplayRows}`);
  console.log(`New replay rows: ${newReplayRows}`);
  console.log(`Checkpoint after recovery: ${checkpointAfterRecovery}`);
  console.log(`Final stored rows: ${finalStoredRows}`);
} finally {
  if (db && !db.closed) {
    await db.close();
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}
