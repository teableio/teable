import { domainError } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { classifyComputedTaskFailure } from './ComputedTaskFailureClassifier';

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
