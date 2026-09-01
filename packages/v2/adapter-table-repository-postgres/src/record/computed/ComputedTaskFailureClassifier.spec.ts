import { domainError } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import {
  classifyComputedTaskFailure,
  isTableProvisionPendingError,
  TABLE_PROVISION_PENDING_CODE,
} from './ComputedTaskFailureClassifier';

describe('classifyComputedTaskFailure', () => {
  it('classifies deterministic postgres sql generation errors as non-retryable code bugs', () => {
    const failure = classifyComputedTaskFailure(
      domainError.infrastructure({
        message:
          'Unexpected unit of work error: error: cannot cast type jsonb to timestamp with time zone',
      })
    );

    expect(failure).toEqual({
      failureKind: 'computed_code_bug',
      failureReason: 'postgres_sql_generation_error',
      retryable: false,
    });
  });

  it('classifies invalid-input-syntax (22P02) as a non-retryable sql generation bug', () => {
    const failure = classifyComputedTaskFailure(
      domainError.infrastructure({
        message:
          'Unexpected unit of work error: error: invalid input syntax for type double precision: "[1.25]"',
      })
    );

    expect(failure).toEqual({
      failureKind: 'computed_code_bug',
      failureReason: 'postgres_sql_generation_error',
      retryable: false,
    });
  });

  it('classifies invalid-input-syntax by SQLSTATE 22P02 as a non-retryable sql generation bug', () => {
    const failure = classifyComputedTaskFailure(
      domainError.infrastructure({
        message: 'unexpected database error (SQLSTATE 22P02)',
      })
    );

    expect(failure).toEqual({
      failureKind: 'computed_code_bug',
      failureReason: 'postgres_sql_generation_error',
      retryable: false,
    });
  });

  it('classifies statement timeouts separately as non-retryable', () => {
    const failure = classifyComputedTaskFailure(
      domainError.infrastructure({
        message: 'canceling statement due to statement timeout',
      })
    );

    expect(failure).toEqual({
      failureKind: 'statement_timeout',
      failureReason: 'statement_timeout',
      retryable: false,
    });
  });

  it('classifies deterministic computed cell limits as non-retryable', () => {
    const failure = classifyComputedTaskFailure(
      domainError.validation({
        code: 'validation.limit.computed_cell_value_max_bytes',
        message: 'Table data safety limit exceeded: validation.limit.computed_cell_value_max_bytes',
      })
    );

    expect(failure).toEqual({
      failureKind: 'data_safety_limit',
      failureReason: 'computed_cell_value_max_bytes',
      retryable: false,
    });
  });

  it('classifies not-null constraint violations as non-retryable data constraints', () => {
    const failure = classifyComputedTaskFailure(
      domainError.infrastructure({
        message:
          'Unexpected unit of work error: error: null value in column "Status" of relation "New_tablefp58qAZIDM" violates not-null constraint',
      })
    );

    expect(failure).toEqual({
      failureKind: 'data_constraint',
      failureReason: 'integrity_constraint_violation',
      retryable: false,
    });
  });

  it('classifies unique constraint violations as non-retryable data constraints', () => {
    const failure = classifyComputedTaskFailure(
      domainError.infrastructure({
        message:
          'error: duplicate key value violates unique constraint "New_tablefp58qAZIDM_Product_ID_key"',
      })
    );

    expect(failure).toEqual({
      failureKind: 'data_constraint',
      failureReason: 'integrity_constraint_violation',
      retryable: false,
    });
  });

  it('classifies stale field references as non-retryable obsolete plans', () => {
    const failure = classifyComputedTaskFailure(
      domainError.notFound({
        message: 'Field not found',
      })
    );

    expect(failure).toEqual({
      failureKind: 'obsolete_plan',
      failureReason: 'stale_field_reference',
      retryable: false,
    });
  });

  it('classifies context-enriched stale field references as non-retryable obsolete plans', () => {
    const failure = classifyComputedTaskFailure(
      domainError.notFound({
        code: 'record.computed.field_not_found',
        message:
          'Field not found: fldAAAAAAAAAAAAAAAA on table tblBBBBBBBBBBBBBBBB (resolving conditional field-reference foreign key)',
      })
    );

    expect(failure).toEqual({
      failureKind: 'obsolete_plan',
      failureReason: 'stale_field_reference',
      retryable: false,
    });
  });

  it('classifies stale table references by error code as non-retryable obsolete plans', () => {
    const failure = classifyComputedTaskFailure(
      domainError.notFound({
        code: 'table.not_found',
        message: 'Table not found (TableByIdSpec) tableId=tbl8NGJLE54NQY50VUu',
      })
    );

    expect(failure).toEqual({
      failureKind: 'obsolete_plan',
      failureReason: 'stale_table_reference',
      retryable: false,
    });
  });

  it('classifies a pending provision table as retryable instead of obsolete', () => {
    const error = domainError.notFound({
      code: TABLE_PROVISION_PENDING_CODE,
      message:
        'Table not found (TableByIdSpec) tableId=tbl8NGJLE54NQY50VUu (provision_state=pending)',
    });
    expect(classifyComputedTaskFailure(error)).toEqual({
      failureKind: 'transient',
      failureReason: 'provision_pending',
      retryable: true,
    });
    expect(isTableProvisionPendingError(error)).toBe(true);
  });

  it('classifies a table.not_found wait-budget message as retryable provision pending', () => {
    const failure = classifyComputedTaskFailure(
      domainError.notFound({
        code: 'table.not_found',
        message:
          'Table not found (TableByIdSpec) tableId=tbl8NGJLE54NQY50VUu (provision_state=pending after 10000ms wait)',
      })
    );

    expect(failure).toEqual({
      failureKind: 'transient',
      failureReason: 'provision_pending',
      retryable: true,
    });
  });

  it('does not treat a table-not-found message without the code as a stale table reference', () => {
    const failure = classifyComputedTaskFailure(
      domainError.notFound({
        message: 'Table not found (TableByIdSpec) tableId=tbl8NGJLE54NQY50VUu',
      })
    );

    expect(failure).toEqual({
      failureKind: 'transient',
      failureReason: 'unknown',
      retryable: true,
    });
  });

  it('classifies TypeError during dirty propagation as a non-retryable code bug', () => {
    const failure = classifyComputedTaskFailure(
      domainError.infrastructure({
        message:
          'Failed to propagate dirty records: TypeError: linkField.relationship is not a function',
      })
    );

    expect(failure).toEqual({
      failureKind: 'computed_code_bug',
      failureReason: 'runtime_type_error',
      retryable: false,
    });
  });

  it('classifies missing physical relations as non-retryable storage errors', () => {
    const failure = classifyComputedTaskFailure(
      domainError.infrastructure({
        message:
          'Failed to propagate dirty records: error: relation "bseQKmXLJBzVxn1zqnR.tbl3UUEXhxH8e0q84MW" does not exist',
      })
    );

    expect(failure).toEqual({
      failureKind: 'storage_missing',
      failureReason: 'missing_relation',
      retryable: false,
    });
  });

  it('classifies read-only database rejections as non-retryable storage errors', () => {
    const failure = classifyComputedTaskFailure(
      domainError.infrastructure({
        message:
          'Outbox transaction failed: error: cannot execute SELECT FOR UPDATE in a read-only transaction',
      })
    );

    expect(failure).toEqual({
      failureKind: 'storage_readonly',
      failureReason: 'readonly_database',
      retryable: false,
    });
  });

  it('classifies read-only database rejections by SQLSTATE code as non-retryable storage errors', () => {
    const failure = classifyComputedTaskFailure(
      domainError.infrastructure({
        message: 'unexpected database error (SQLSTATE 25006)',
      })
    );

    expect(failure).toEqual({
      failureKind: 'storage_readonly',
      failureReason: 'readonly_database',
      retryable: false,
    });
  });

  it('classifies JavaScript call-stack overflows as non-retryable code bugs', () => {
    const failure = classifyComputedTaskFailure(
      domainError.infrastructure({
        message: 'Unexpected unit of work error: RangeError: Maximum call stack size exceeded',
      })
    );

    expect(failure).toEqual({
      failureKind: 'computed_code_bug',
      failureReason: 'call_stack_overflow',
      retryable: false,
    });
  });

  it('keeps unknown infrastructure errors retryable', () => {
    const failure = classifyComputedTaskFailure(
      domainError.infrastructure({
        message: 'connection terminated unexpectedly',
      })
    );

    expect(failure).toEqual({
      failureKind: 'transient',
      failureReason: 'unknown',
      retryable: true,
    });
  });
});
