import "dotenv/config";
import { Connection } from "@solana/web3.js";

const APPROXIMATE_ONE_DAY_IN_SLOTS = 216_000;
const CANDIDATE_WINDOW_SIZE = 20;
const BLOCKS_TO_FETCH = 3;

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

function formatBlockTime(blockTime: number | null): string {
  return blockTime === null
    ? "timestamp unavailable"
    : new Date(blockTime * 1_000).toISOString();
}

async function main(): Promise<void> {
  const connection = new Connection(rpcUrl, {
    commitment: "finalized",
  });

  const finalizedTip = await connection.getSlot("finalized");
  const candidateEnd = finalizedTip - APPROXIMATE_ONE_DAY_IN_SLOTS;
  const candidateStart = candidateEnd - CANDIDATE_WINDOW_SIZE + 1;

  if (candidateStart <= 0) {
    throw new Error("Calculated historical slot window is invalid.");
  }

  const producedSlots = await connection.getBlocks(
    candidateStart,
    candidateEnd,
    "finalized",
  );
  const selectedSlots = producedSlots.slice(0, BLOCKS_TO_FETCH);

  if (selectedSlots.length === 0) {
    throw new Error(
      `No produced blocks found in candidate window ${candidateStart}-${candidateEnd}.`,
    );
  }

  const summaries: Array<{
    slot: number;
    blockTime: number | null;
    transactionCount: number;
  }> = [];

  for (const slot of selectedSlots) {
    const block = await connection.getBlock(slot, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
      rewards: false,
      transactionDetails: "full",
    });

    if (block === null) {
      continue;
    }

    summaries.push({
      slot,
      blockTime: block.blockTime,
      transactionCount: block.transactions.length,
    });
  }

  if (summaries.length === 0) {
    throw new Error("Produced slots were found, but no blocks could be fetched.");
  }

  console.log("Historical block test succeeded.");
  console.log(`Current finalized slot: ${finalizedTip}`);
  console.log(`Candidate window: ${candidateStart}-${candidateEnd}`);
  console.log(`Produced slots found: ${producedSlots.length}`);
  console.log(`Historical blocks fetched: ${summaries.length}`);

  for (const summary of summaries) {
    console.log(
      `- Slot ${summary.slot} | ${formatBlockTime(summary.blockTime)} | ${summary.transactionCount} transactions`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Historical block test failed: ${redactApiKey(message)}`);
  process.exitCode = 1;
});
