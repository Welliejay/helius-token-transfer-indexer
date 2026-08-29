import "dotenv/config";
import {
  CommitmentLevel,
  shutdownAllStreams,
  subscribe,
  type LaserstreamConfig,
  type StreamHandle,
  type SubscribeRequest,
} from "helius-laserstream";
import {
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "./token-transfer-parser.js";

const DEVNET_ENDPOINT = "https://laserstream-devnet-ewr.helius-rpc.com";
const TIMEOUT_MS = 45_000;

interface LiveSample {
  slot: string;
  filters: string[];
  signatureBytes: number;
  signatureHexPrefix: string;
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

function redactApiKey(message: string): string {
  return message
    .replaceAll(apiKey, "[REDACTED]")
    .replaceAll(encodeURIComponent(apiKey), "[REDACTED]");
}

const request: SubscribeRequest = {
  transactions: {
    "token-program-live": {
      accountInclude: [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID],
      accountExclude: [],
      accountRequired: [],
      vote: false,
      failed: false,
    },
  },
  commitment: CommitmentLevel.CONFIRMED,
  accounts: {},
  slots: {},
  transactionsStatus: {},
  blocks: {},
  blocksMeta: {},
  entry: {},
  accountsDataSlice: [],
};

async function receiveOneSample(): Promise<LiveSample> {
  const config: LaserstreamConfig = {
    apiKey,
    endpoint: DEVNET_ENDPOINT,
    maxReconnectAttempts: 1,
    replay: false,
  };

  let streamHandle: StreamHandle | null = null;
  let cancelWhenReady = false;

  return new Promise<LiveSample>((resolve, reject) => {
    let settled = false;
    const finish = (
      outcome: { sample: LiveSample } | { error: Error },
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (streamHandle) streamHandle.cancel();
      else cancelWhenReady = true;

      if ("sample" in outcome) resolve(outcome.sample);
      else reject(outcome.error);
    };

    const timeout = setTimeout(() => {
      finish({
        error: new Error(
          `No matching LaserStream update arrived within ${TIMEOUT_MS / 1_000} seconds`,
        ),
      });
    }, TIMEOUT_MS);

    void subscribe(
      config,
      request,
      (update) => {
        const transactionUpdate = update.transaction;
        const signature = transactionUpdate?.transaction?.signature;
        if (!transactionUpdate || !signature || signature.length === 0) return;

        finish({
          sample: {
            slot: transactionUpdate.slot.toString(),
            filters: [...update.filters],
            signatureBytes: signature.length,
            signatureHexPrefix: Buffer.from(signature)
              .toString("hex")
              .slice(0, 16),
          },
        });
      },
      (error) => finish({ error }),
    )
      .then((handle) => {
        streamHandle = handle;
        if (cancelWhenReady) streamHandle.cancel();
      })
      .catch((error: unknown) => {
        finish({
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
  });
}

async function main(): Promise<void> {
  try {
    const sample = await receiveOneSample();

    console.log("LaserStream live test succeeded.");
    console.log("Network: devnet");
    console.log("Commitment: confirmed");
    console.log(`Slot: ${sample.slot}`);
    console.log(`Matched filters: ${sample.filters.join(", ")}`);
    console.log(`Signature bytes: ${sample.signatureBytes}`);
    console.log(`Signature hex prefix: ${sample.signatureHexPrefix}`);
  } finally {
    shutdownAllStreams();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LaserStream live test failed: ${redactApiKey(message)}`);
  process.exitCode = 1;
});
