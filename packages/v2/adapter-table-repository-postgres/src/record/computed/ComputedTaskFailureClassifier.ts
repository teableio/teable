import {
  domainError,
  type DomainError,
  isTableProvisionPendingError as hasProvisionPendingCode,
} from '@teable/v2-core';

export { TABLE_PROVISION_PENDING_CODE } from '@teable/v2-core';

const POSTGRES_STATEMENT_TIMEOUT_CODE = '57014';
const POSTGRES_READ_ONLY_TRANSACTION_CODE = '25006';
/** SQLSTATE 22P02 — invalid_text_representation. Deterministic for the same SQL and values. */
const POSTGRES_INVALID_TEXT_REPRESENTATION_CODE = '22P02';

export type ComputedTaskFailureKind =
  | 'transient'
  | 'statement_timeout'
  | 'computed_code_bug'
  | 'data_safety_limit'
  | 'data_constraint'
  | 'obsolete_plan'
  | 'storage_missing'
  | 'storage_readonly';

export type ComputedTaskFailureReason =
  | 'unknown'
  | 'statement_timeout'
  | 'postgres_sql_generation_error'
  | 'call_stack_overflow'
  | 'computed_cell_value_max_bytes'
  | 'formula_compile_budget'
  | 'computed_resource_limit'
  | 'stage_depth_exhausted'
  | 'integrity_constraint_violation'
  | 'stale_field_reference'
  | 'stale_table_reference'
  | 'missing_relation'
  | 'readonly_database'
  | 'runtime_type_error'
  | 'provision_pending';

export type ComputedTaskFailureClassification = {
  failureKind: ComputedTaskFailureKind;
  failureReason: ComputedTaskFailureReason;
  retryable: boolean;
};

const FORMULA_COMPILE_BUDGET_CODES: Readonly<Record<string, true>> = {
  'validation.limit.formula_compile_nodes_max': true,
  'validation.limit.formula_compile_depth_max': true,
  'validation.limit.formula_reference_depth_max': true,
  'validation.limit.formula_bindings_max': true,
  'validation.limit.formula_compile_bytes_max': true,
  'validation.limit.formula_sql_bytes_max': true,
};
const COMPUTED_RESOURCE_LIMIT_CODE = 'computed.resource_limit';
const STAGE_DEPTH_EXHAUSTED_CODE = 'computed.stage_depth_exhausted';
const POSTGRES_PROGRAM_LIMIT_CODES: Readonly<Record<string, true>> = {
  '54000': true,
  '54001': true,
};

type StructuredError = {
  code?: unknown;
  sqlState?: unknown;
  sqlstate?: unknown;
  pgCode?: unknown;
  details?: unknown;
  cause?: unknown;
  postgresSql?: unknown;
  postgres?: unknown;
};

/** Inspect only bounded structured metadata; messages are intentionally excluded. */
const hasStructuredCode = (error: DomainError, codes: Readonly<Record<string, true>>): boolean => {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: error, depth: 0 }];
  let visited = 0;
  while (queue.length && visited++ < 64) {
    const item = queue.shift();
    if (!item || item.depth > 4 || typeof item.value !== 'object' || item.value === null) continue;
    const value = item.value as StructuredError;
    if (typeof value.code === 'string' && Object.hasOwn(codes, value.code)) return true;
    for (const key of ['details', 'cause'] as const) {
      const child = value[key];
      if (child && typeof child === 'object') queue.push({ value: child, depth: item.depth + 1 });
    }
  }
  return false;
};

const hasProgramLimitSqlState = (error: DomainError): boolean => {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: error, depth: 0 }];
  let visited = 0;
  while (queue.length && visited++ < 64) {
    const item = queue.shift();
    if (!item || item.depth > 4 || typeof item.value !== 'object' || item.value === null) continue;
    const value = item.value as StructuredError;
    if (
      (typeof value.code === 'string' && Object.hasOwn(POSTGRES_PROGRAM_LIMIT_CODES, value.code)) ||
      (typeof value.pgCode === 'string' &&
        Object.hasOwn(POSTGRES_PROGRAM_LIMIT_CODES, value.pgCode)) ||
      (typeof value.sqlState === 'string' &&
        Object.hasOwn(POSTGRES_PROGRAM_LIMIT_CODES, value.sqlState)) ||
      (typeof value.sqlstate === 'string' &&
        Object.hasOwn(POSTGRES_PROGRAM_LIMIT_CODES, value.sqlstate))
    )
      return true;
    for (const key of ['details', 'cause', 'postgresSql', 'postgres'] as const) {
      const child = value[key];
      if (child && typeof child === 'object') queue.push({ value: child, depth: item.depth + 1 });
    }
  }
  return false;
};

const SQL_GENERATION_BUG_PATTERNS: ReadonlyArray<RegExp> = [
  /cannot cast type .+ to .+/,
  /operator does not exist:/,
  /function .+ does not exist/,
  /syntax error at or near/,
  /case types .+ cannot be matched/,
  /column .+ does not exist/,
  /missing from-clause entry for table/,
  /invalid input syntax for type/,
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
  return (
    normalized.includes(POSTGRES_INVALID_TEXT_REPRESENTATION_CODE.toLowerCase()) ||
    SQL_GENERATION_BUG_PATTERNS.some((pattern) => pattern.test(normalized))
  );
};

const isRuntimeTypeErrorMessage = (message: string): boolean => /typeerror:/i.test(message);

/**
 * Integrity-constraint violations (SQLSTATE class 23) are deterministic given
 * the data: a computed refresh that derives NULL for a user-required column, or
 * a duplicate for a unique one, fails identically on every attempt until the
 * field constraint or the underlying records change. Retrying only burns
 * max_attempts claims before dead-lettering anyway.
 */
const isIntegrityConstraintMessage = (message: string): boolean =>
  /violates (?:not-null|unique|check|foreign key|exclusion) constraint/i.test(message);

/**
 * Persisted plans can reference fields deleted between planning and execution.
 * Retrying cannot resurrect the field, so a retry loop only amplifies load
 * (max_attempts claims per task) before dead-lettering anyway.
 */
const isStaleFieldReferenceMessage = (message: string): boolean =>
  /\bfield not found\b/i.test(message);

/**
 * A table whose metadata is alive but whose physical relation is missing (a
 * "ghost" table — e.g. DDL executed against the wrong database) fails every
 * statement that touches it. Retrying cannot materialize the relation, so the
 * retry loop only burns pool time before dead-lettering anyway.
 */
const isMissingRelationMessage = (message: string): boolean =>
  /relation .+ does not exist/i.test(message);

/**
 * A read-only storage database (SQLSTATE 25006 — e.g. a BYODB Supabase project
 * forced read-only by its disk quota, or a replica endpoint) rejects every
 * write until an operator restores writability. Retrying burns claims against
 * a database that cannot make progress; the group is recoverable by replay
 * once the database accepts writes again.
 */
const isReadOnlyDatabaseMessage = (message: string): boolean =>
  /in a read-only transaction/i.test(message) ||
  message.includes(POSTGRES_READ_ONLY_TRANSACTION_CODE);

/**
 * `push(...hugeArray)` and unbounded recursion fail the same way on every
 * attempt. Retrying only burns max_attempts before dead-lettering (T2511 / T6713).
 */
const isCallStackOverflowMessage = (message: string): boolean =>
  /maximum call stack size exceeded/i.test(message);

export const isTableProvisionPendingError = (error: { code?: string; message?: string }): boolean =>
  hasProvisionPendingCode(error) || /provision_state=pending/i.test(error.message ?? '');

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

  if (isTableProvisionPendingError(error)) {
    return {
      failureKind: 'transient',
      failureReason: 'provision_pending',
      retryable: true,
    };
  }

  // Tasks enqueued while a table was alive fail deterministically once the
  // table is deleted (soft or permanent). The worker completes those tasks
  // instead of retrying; this branch is a safety net for other table.not_found
  // errors that still reach the classifier.
  if (error.code === 'table.not_found') {
    return {
      failureKind: 'obsolete_plan',
      failureReason: 'stale_table_reference',
      retryable: false,
    };
  }

  // Timeouts are load-dependent, not deterministic: the same SQL can succeed
  // once contention drops. Treating them like SQL-generation bugs dead-letters
  // on the first attempt and leaves computed values permanently stale.
  if (isStatementTimeoutMessage(message)) {
    return {
      failureKind: 'statement_timeout',
      failureReason: 'statement_timeout',
      retryable: true,
    };
  }

  if (hasStructuredCode(error, FORMULA_COMPILE_BUDGET_CODES)) {
    return {
      failureKind: 'data_safety_limit',
      failureReason: 'formula_compile_budget',
      retryable: false,
    };
  }
  if (
    hasStructuredCode(error, { [COMPUTED_RESOURCE_LIMIT_CODE]: true }) ||
    hasProgramLimitSqlState(error)
  ) {
    return {
      failureKind: 'data_safety_limit',
      failureReason: 'computed_resource_limit',
      retryable: false,
    };
  }
  if (hasStructuredCode(error, { [STAGE_DEPTH_EXHAUSTED_CODE]: true })) {
    return {
      failureKind: 'data_safety_limit',
      failureReason: 'stage_depth_exhausted',
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

  if (isCallStackOverflowMessage(message)) {
    return {
      failureKind: 'computed_code_bug',
      failureReason: 'call_stack_overflow',
      retryable: false,
    };
  }

  if (isRuntimeTypeErrorMessage(message)) {
    return {
      failureKind: 'computed_code_bug',
      failureReason: 'runtime_type_error',
      retryable: false,
    };
  }

  if (isIntegrityConstraintMessage(message)) {
    return {
      failureKind: 'data_constraint',
      failureReason: 'integrity_constraint_violation',
      retryable: false,
    };
  }

  if (isStaleFieldReferenceMessage(message)) {
    return {
      failureKind: 'obsolete_plan',
      failureReason: 'stale_field_reference',
      retryable: false,
    };
  }

  if (isMissingRelationMessage(message)) {
    return {
      failureKind: 'storage_missing',
      failureReason: 'missing_relation',
      retryable: false,
    };
  }

  if (isReadOnlyDatabaseMessage(message)) {
    return {
      failureKind: 'storage_readonly',
      failureReason: 'readonly_database',
      retryable: false,
    };
  }

  return {
    failureKind: 'transient',
    failureReason: 'unknown',
    retryable: true,
  };
};
/** Map only structured PostgreSQL program-limit metadata to a safe generic error. */
export const normalizeComputedTaskError = (error: DomainError): DomainError => {
  if (!hasProgramLimitSqlState(error)) return error;
  return domainError.infrastructure({
    code: COMPUTED_RESOURCE_LIMIT_CODE,
    message: 'Computed calculation exceeded a resource limit.',
    cause: error,
    details: error.details,
  });
};
