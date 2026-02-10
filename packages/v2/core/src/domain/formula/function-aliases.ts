/* eslint-disable @typescript-eslint/naming-convention */
import { FunctionName } from './functions/common';

/**
 * Maps non-standard function tokens to their canonical FunctionName
 * counterpart so both formula evaluation and SQL conversion share the
 * same normalization logic.
 */
export const FUNCTION_NAME_ALIASES: Record<string, FunctionName> = {
  ARRAYJOIN: FunctionName.ArrayJoin,
  ARRAYUNIQUE: FunctionName.ArrayUnique,
  ARRAYFLATTEN: FunctionName.ArrayFlatten,
  ARRAYCOMPACT: FunctionName.ArrayCompact,
};

/**
 * Normalize a function token (already uppercased) to its canonical
 * FunctionName enum when an alias is declared. Returns the original
 * token when no alias is registered.
 */
export const normalizeFunctionNameAlias = (token: string): string =>
  FUNCTION_NAME_ALIASES[token] ?? token;
