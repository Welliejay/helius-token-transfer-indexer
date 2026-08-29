import "dotenv/config";
import { Connection } from "@solana/web3.js";

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
  const connection = new Connection(rpcUrl, {
    commitment: "finalized",
  });

  const slot = await connection.getSlot("finalized");

  if (!Number.isSafeInteger(slot) || slot <= 0) {
    throw new Error(`RPC returned an invalid finalized slot: ${slot}`);
  }

  console.log("Helius RPC connection succeeded.");
  console.log(`Finalized slot: ${slot}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Helius RPC connection failed: ${redactApiKey(message)}`);
  process.exitCode = 1;
});
