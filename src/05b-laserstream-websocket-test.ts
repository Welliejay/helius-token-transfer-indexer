import assert from "node:assert/strict";
import "dotenv/config";
import { SPL_TOKEN_PROGRAM_ID } from "./token-transfer-parser.js";

const TIMEOUT_MS = 30_000;

interface LogsSample {
  slot: number;
  signature: string;
  logCount: number;
}

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
const websocketUrl = `wss://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`;

function redactApiKey(message: string): string {
  return message
    .replaceAll(apiKey, "[REDACTED]")
    .replaceAll(encodeURIComponent(apiKey), "[REDACTED]");
}

async function receiveOneLogSample(): Promise<LogsSample> {
  return new Promise<LogsSample>((resolve, reject) => {
    const websocket = new WebSocket(websocketUrl);
    let settled = false;
    let subscriptionConfirmed = false;

    const finish = (
      outcome: { sample: LogsSample } | { error: Error },
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      websocket.close();

      if ("sample" in outcome) resolve(outcome.sample);
      else reject(outcome.error);
    };

    const timeout = setTimeout(() => {
      finish({
        error: new Error(
          `No WebSocket log notification arrived within ${TIMEOUT_MS / 1_000} seconds`,
        ),
      });
    }, TIMEOUT_MS);

    websocket.addEventListener("open", () => {
      websocket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "logsSubscribe",
          params: [
            { mentions: [SPL_TOKEN_PROGRAM_ID] },
            { commitment: "confirmed" },
          ],
        }),
      );
    });

    websocket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data)) as {
        id?: number;
        result?: number;
        error?: { message?: string };
        method?: string;
        params?: {
          result?: {
            context?: { slot?: number };
            value?: {
              signature?: string;
              logs?: string[];
            };
          };
        };
      };

      if (payload.error) {
        finish({
          error: new Error(payload.error.message ?? "WebSocket RPC error"),
        });
        return;
      }

      if (payload.id === 1 && typeof payload.result === "number") {
        subscriptionConfirmed = true;
        return;
      }

      if (payload.method !== "logsNotification") return;

      const slot = payload.params?.result?.context?.slot;
      const signature = payload.params?.result?.value?.signature;
      const logs = payload.params?.result?.value?.logs;

      assert.equal(subscriptionConfirmed, true);
      if (
        typeof slot !== "number" ||
        typeof signature !== "string" ||
        !Array.isArray(logs)
      ) {
        finish({ error: new Error("Malformed WebSocket log notification") });
        return;
      }

      finish({
        sample: {
          slot,
          signature,
          logCount: logs.length,
        },
      });
    });

    websocket.addEventListener("error", () => {
      finish({ error: new Error("WebSocket transport error") });
    });
  });
}

async function main(): Promise<void> {
  const sample = await receiveOneLogSample();

  console.log("LaserStream WebSocket live test succeeded.");
  console.log("Network: mainnet");
  console.log("Commitment: confirmed");
  console.log(`Slot: ${sample.slot}`);
  console.log(`Signature: ${sample.signature}`);
  console.log(`Log messages: ${sample.logCount}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LaserStream WebSocket test failed: ${redactApiKey(message)}`);
  process.exitCode = 1;
});
