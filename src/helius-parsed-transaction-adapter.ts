import type {
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
} from "@solana/web3.js";
import type {
  ParsedInstructionInput,
  ParserTransactionInput,
  TokenBalanceInput,
} from "./token-transfer-parser.js";

type RpcInstruction = ParsedInstruction | PartiallyDecodedInstruction;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function adaptInstruction(instruction: RpcInstruction): ParsedInstructionInput {
  if (!("parsed" in instruction)) {
    return { programId: instruction.programId.toBase58() };
  }

  const parsed = isRecord(instruction.parsed) ? instruction.parsed : {};
  const info = isRecord(parsed.info) ? parsed.info : undefined;

  return {
    programId: instruction.programId.toBase58(),
    parsed: {
      type: typeof parsed.type === "string" ? parsed.type : undefined,
      info,
    },
  };
}

export function adaptHeliusParsedTransaction(
  response: ParsedTransactionWithMeta,
): ParserTransactionInput {
  const signature = response.transaction.signatures[0];
  if (!signature) throw new Error("Transaction has no signature");
  if (!response.meta) throw new Error("Transaction has no metadata");

  const accountKeys = response.transaction.message.accountKeys.map((account) =>
    account.pubkey.toBase58(),
  );
  const balancesByAccountIndex = new Map<number, TokenBalanceInput>();

  for (const balance of [
    ...(response.meta.preTokenBalances ?? []),
    ...(response.meta.postTokenBalances ?? []),
  ]) {
    balancesByAccountIndex.set(balance.accountIndex, {
      accountIndex: balance.accountIndex,
      mint: balance.mint,
      decimals: balance.uiTokenAmount.decimals,
    });
  }

  return {
    signature,
    accountKeys,
    tokenBalances: [...balancesByAccountIndex.values()],
    topLevelInstructions: response.transaction.message.instructions
      .map(adaptInstruction),
    innerInstructionGroups: (response.meta.innerInstructions ?? []).map(
      (group) => ({
        parentInstructionIndex: group.index,
        instructions: group.instructions
          .map(adaptInstruction),
      }),
    ),
  };
}
