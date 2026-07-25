import type { DomainError } from '@teable/v2-core';

const POSTGRES_STATEMENT_TIMEOUT_CODE = '57014';

export type ComputedTaskFailureKind =
  | 'transient'
  | 'statement_timeout'
  | 'computed_code_bug'
  | 'data_safety_limit';

export type ComputedTaskFailureReason =
  | 'unknown'
  | 'statement_timeout'
  | 'postgres_sql_generation_error'
  | 'computed_cell_value_max_bytes';

export type ComputedTaskFailureClassification = {
  failureKind: ComputedTaskFailureKind;
  failureReason: ComputedTaskFailureReason;
  retryable: boolean;
};

const SQL_GENERATION_BUG_PATTERNS: ReadonlyArray<RegExp> = [
  /cannot cast type .+ to .+/,
  /operator does not exist:/,
  /function .+ does not exist/,
  /syntax error at or near/,
  /case types .+ cannot be matched/,
  /column .+ does not exist/,
  /missing from-clause entry for table/,
];

const isStatementTimeoutMessage = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes(POSTGRES_STATEMENT_TIMEOUT_CODE) ||
    normalized.includes('statement timeout') ||
    normalized.includes('canceling statement due to statement timeout')
  );
};

const isSqlGenerationBugMessage = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return SQL_GENERATION_BUG_PATTERNS.some((pattern) => pattern.test(normalized));
};

export const classifyComputedTaskFailure = (
  error: DomainError
): ComputedTaskFailureClassification => {
  const message = error.message;

  if (error.code === 'validation.limit.computed_cell_value_max_bytes') {
    return {
      failureKind: 'data_safety_limit',
      failureReason: 'computed_cell_value_max_bytes',
      retryable: false,
    };
  }

  if (isStatementTimeoutMessage(message)) {
    return {
      failureKind: 'statement_timeout',
      failureReason: 'statement_timeout',
      retryable: false,
    };
  }

  if (isSqlGenerationBugMessage(message)) {
    return {
      failureKind: 'computed_code_bug',
      failureReason: 'postgres_sql_generation_error',
      retryable: false,
    };
  }

  return {
    failureKind: 'transient',
    failureReason: 'unknown',
    retryable: true,
  };
};
