export const SPL_TOKEN_PROGRAM_ID =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export interface ParsedInstructionInput {
  programId: string;
  parsed?: {
    type?: string;
    info?: Record<string, unknown>;
  };
}

export interface TokenBalanceInput {
  accountIndex: number;
  mint: string;
  decimals: number;
}

export interface ParserTransactionInput {
  signature: string;
  accountKeys: string[];
  topLevelInstructions: ParsedInstructionInput[];
  innerInstructionGroups: Array<{
    parentInstructionIndex: number;
    instructions: ParsedInstructionInput[];
  }>;
  tokenBalances: TokenBalanceInput[];
}

export interface NormalizedTokenTransfer {
  id: string;
  signature: string;
  instructionLocation: string;
  tokenProgram: "spl-token" | "token-2022";
  programId: string;
  mint: string;
  sourceTokenAccount: string;
  destinationTokenAccount: string;
  authority: string | null;
  rawAmount: string;
  decimals: number | null;
}

export interface ParseIssue {
  instructionLocation: string;
  reason: string;
}

export interface ParseResult {
  transfers: NormalizedTokenTransfer[];
  issues: ParseIssue[];
}

interface TokenAccountMetadata {
  mint: string;
  decimals: number;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function tokenProgramName(
  programId: string,
): NormalizedTokenTransfer["tokenProgram"] | null {
  if (programId === SPL_TOKEN_PROGRAM_ID) return "spl-token";
  if (programId === TOKEN_2022_PROGRAM_ID) return "token-2022";
  return null;
}

function buildTokenAccountMap(
  transaction: ParserTransactionInput,
): Map<string, TokenAccountMetadata> {
  const result = new Map<string, TokenAccountMetadata>();

  for (const balance of transaction.tokenBalances) {
    const tokenAccount = transaction.accountKeys[balance.accountIndex];
    if (tokenAccount) {
      result.set(tokenAccount, {
        mint: balance.mint,
        decimals: balance.decimals,
      });
    }
  }

  return result;
}

export function parseTokenTransfers(
  transaction: ParserTransactionInput,
  targetMint: string,
): ParseResult {
  const transfers: NormalizedTokenTransfer[] = [];
  const issues: ParseIssue[] = [];
  const tokenAccounts = buildTokenAccountMap(transaction);

  const inspect = (
    instruction: ParsedInstructionInput,
    instructionLocation: string,
  ): void => {
    const tokenProgram = tokenProgramName(instruction.programId);
    if (!tokenProgram) return;

    const instructionType = instruction.parsed?.type;
    if (instructionType !== "transfer" && instructionType !== "transferChecked") {
      return;
    }

    const info = instruction.parsed?.info;
    if (!info) {
      issues.push({ instructionLocation, reason: "Missing parsed transfer info" });
      return;
    }

    const source = readString(info.source);
    const destination = readString(info.destination);
    const tokenAmount = readRecord(info.tokenAmount);
    const rawAmount = readString(info.amount) ?? readString(tokenAmount?.amount);
    const accountMetadata = source ? tokenAccounts.get(source) : undefined;
    const mint = readString(info.mint) ?? accountMetadata?.mint ?? null;
    const parsedDecimals = tokenAmount?.decimals;
    const decimals =
      typeof parsedDecimals === "number"
        ? parsedDecimals
        : (accountMetadata?.decimals ?? null);

    if (!source || !destination || !rawAmount || !mint) {
      issues.push({
        instructionLocation,
        reason: "Could not resolve source, destination, amount, or mint",
      });
      return;
    }

    if (mint !== targetMint) return;

    transfers.push({
      id: `${transaction.signature}:${instructionLocation}`,
      signature: transaction.signature,
      instructionLocation,
      tokenProgram,
      programId: instruction.programId,
      mint,
      sourceTokenAccount: source,
      destinationTokenAccount: destination,
      authority: readString(info.authority),
      rawAmount,
      decimals,
    });
  };

  transaction.topLevelInstructions.forEach((instruction, index) => {
    inspect(instruction, `top:${index}`);
  });

  for (const group of transaction.innerInstructionGroups) {
    group.instructions.forEach((instruction, innerIndex) => {
      inspect(
        instruction,
        `inner:${group.parentInstructionIndex}:${innerIndex}`,
      );
    });
  }

  return { transfers, issues };
}
