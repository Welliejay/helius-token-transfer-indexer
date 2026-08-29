import assert from "node:assert/strict";
import {
  parseTokenTransfers,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  type ParserTransactionInput,
} from "./token-transfer-parser.js";

const CLASSIC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN_2022_MINT = "Fx1JZFeYbCxLrMv7422YSxpr7YzcsAgpU1MkjZTyCKi2";
const SIGNATURE = "fixture-signature-001";

const fixture: ParserTransactionInput = {
  signature: SIGNATURE,
  accountKeys: [
    "payer",
    "classic-source-a",
    "classic-destination-a",
    "classic-source-b",
    "classic-destination-b",
    "token-2022-source",
    "token-2022-destination",
  ],
  tokenBalances: [
    { accountIndex: 3, mint: CLASSIC_MINT, decimals: 6 },
    { accountIndex: 4, mint: CLASSIC_MINT, decimals: 6 },
  ],
  topLevelInstructions: [
    {
      programId: "11111111111111111111111111111111",
      parsed: { type: "transfer", info: { lamports: 5_000 } },
    },
    {
      programId: SPL_TOKEN_PROGRAM_ID,
      parsed: {
        type: "transferChecked",
        info: {
          source: "classic-source-a",
          destination: "classic-destination-a",
          authority: "classic-owner-a",
          mint: CLASSIC_MINT,
          tokenAmount: { amount: "1500000", decimals: 6 },
        },
      },
    },
  ],
  innerInstructionGroups: [
    {
      parentInstructionIndex: 1,
      instructions: [
        {
          programId: SPL_TOKEN_PROGRAM_ID,
          parsed: {
            type: "transfer",
            info: {
              source: "classic-source-b",
              destination: "classic-destination-b",
              authority: "classic-owner-b",
              amount: "250000",
            },
          },
        },
        {
          programId: TOKEN_2022_PROGRAM_ID,
          parsed: {
            type: "transferChecked",
            info: {
              source: "token-2022-source",
              destination: "token-2022-destination",
              authority: "token-2022-owner",
              mint: TOKEN_2022_MINT,
              tokenAmount: { amount: "4200", decimals: 2 },
            },
          },
        },
      ],
    },
  ],
};

const classicResult = parseTokenTransfers(fixture, CLASSIC_MINT);
const token2022Result = parseTokenTransfers(fixture, TOKEN_2022_MINT);
const malformedResult = parseTokenTransfers(
  {
    signature: "fixture-malformed-001",
    accountKeys: [],
    tokenBalances: [],
    innerInstructionGroups: [],
    topLevelInstructions: [
      {
        programId: SPL_TOKEN_PROGRAM_ID,
        parsed: { type: "transfer", info: { amount: "1" } },
      },
    ],
  },
  CLASSIC_MINT,
);

assert.equal(classicResult.issues.length, 0);
assert.equal(classicResult.transfers.length, 2);
assert.deepEqual(
  classicResult.transfers.map((transfer) => transfer.instructionLocation),
  ["top:1", "inner:1:0"],
);
assert.deepEqual(
  classicResult.transfers.map((transfer) => transfer.rawAmount),
  ["1500000", "250000"],
);
assert.ok(
  classicResult.transfers.every(
    (transfer) => transfer.tokenProgram === "spl-token",
  ),
);

assert.equal(token2022Result.issues.length, 0);
assert.equal(token2022Result.transfers.length, 1);
assert.equal(token2022Result.transfers[0]?.instructionLocation, "inner:1:1");
assert.equal(token2022Result.transfers[0]?.tokenProgram, "token-2022");
assert.equal(token2022Result.transfers[0]?.rawAmount, "4200");

assert.equal(malformedResult.transfers.length, 0);
assert.equal(malformedResult.issues.length, 1);
assert.equal(malformedResult.issues[0]?.instructionLocation, "top:0");

const allIds = [
  ...classicResult.transfers,
  ...token2022Result.transfers,
].map((transfer) => transfer.id);
assert.equal(new Set(allIds).size, allIds.length);

console.log("Token transfer parser test succeeded.");
console.log(`Fixture signature: ${SIGNATURE}`);
console.log(`Classic SPL transfers matched: ${classicResult.transfers.length}`);
console.log(`Token-2022 transfers matched: ${token2022Result.transfers.length}`);
console.log(`Unique instruction IDs verified: ${allIds.length}`);
console.log(`Malformed transfer issues verified: ${malformedResult.issues.length}`);

for (const transfer of [
  ...classicResult.transfers,
  ...token2022Result.transfers,
]) {
  console.log(
    `- ${transfer.instructionLocation} | ${transfer.tokenProgram} | raw amount ${transfer.rawAmount}`,
  );
}
