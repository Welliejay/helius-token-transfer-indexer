CREATE TABLE IF NOT EXISTS token_transfers (
  transfer_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  instruction_location TEXT NOT NULL,
  slot BIGINT NOT NULL CHECK (slot >= 0),
  block_time TIMESTAMPTZ,
  token_program TEXT NOT NULL
    CHECK (token_program IN ('spl-token', 'token-2022')),
  mint TEXT NOT NULL,
  source_token_account TEXT NOT NULL,
  destination_token_account TEXT NOT NULL,
  authority TEXT,
  raw_amount NUMERIC(78, 0) NOT NULL CHECK (raw_amount >= 0),
  decimals SMALLINT CHECK (decimals BETWEEN 0 AND 255),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT token_transfers_pkey
    PRIMARY KEY (signature, instruction_location),
  CONSTRAINT token_transfers_transfer_id_key
    UNIQUE (transfer_id),
  CONSTRAINT token_transfers_transfer_id_matches
    CHECK (transfer_id = signature || ':' || instruction_location)
);

CREATE TABLE IF NOT EXISTS ingestion_checkpoints (
  source TEXT PRIMARY KEY,
  last_completed_slot BIGINT NOT NULL CHECK (last_completed_slot >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
