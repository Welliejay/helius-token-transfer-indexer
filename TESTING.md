# Testing checklist

## Verification rule

A test is only considered complete after it has been run locally and the expected behavior has been observed.

## Verified locally

- [x] 01 — Helius RPC connection at `finalized` commitment
- [x] 02 — Historical block retrieval from Helius mainnet RPC
- [x] 03 — SPL Token and Token-2022 transfer parsing with top-level and inner instruction locations
- [x] 03b — Parsing a real finalized USDC transaction returned by Helius
- [x] 04 — Replaying the same transfer does not create a second database row, while a different instruction location in the same transaction creates a separate row
- [x] 05 — LaserStream live transaction delivery at `confirmed` commitment
- [x] 05b — Helius mainnet WebSocket live notification sanity check
- [x] 06 — Recovery after a restart using a saved checkpoint, overlapping replay, and duplicate protection

## Setup

```bash
npm install
cp .env.example .env
```

Add a Helius API key to `.env`, then run the checks:

```bash
npm run test:rpc
npm run test:block
npm run test:parser
npm run test:parser:real
npm run test:db
npm run test:laserstream
npm run test:laserstream:ws
npm run test:replay
npm run typecheck
```

## What these tests check

The tests use small ranges and focused examples. They are meant to check the design, not benchmark a production-scale 30-day backfill.

They show that:

- Helius RPC can return finalized historical Solana data.
- Token transfers can be tracked at separate top-level or inner instruction locations.
- A transaction signature alone is not enough to identify every transfer in a transaction.
- Replaying the same transfer does not create a duplicate database row.
- A saved checkpoint survives a restart and can be used to replay from an earlier safe point.
- Overlapping replay does not create duplicate transfer rows.
- LaserStream can provide live transaction updates for the token programs.
