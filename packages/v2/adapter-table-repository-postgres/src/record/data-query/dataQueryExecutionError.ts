import { domainError, type DomainError } from '@teable/v2-core';

/** Never expose SQL, values, driver messages, positions, or cast input details. */
export const dataQueryExecutionError = (error: unknown, expressions: boolean): DomainError => {
  const state =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[0-9A-Z]{5}$/.test(error.code)
      ? error.code
      : undefined;
  if (state === '57014') {
    return domainError.infrastructure({
      code: 'data_query.timeout',
      message: 'Data query exceeded its statement timeout',
      details: { sqlState: state },
    });
  }
  if (expressions && state === '54000') {
    return domainError.validation({
      code: 'data_query.expression_resource_limit',
      message: 'A data query expression exceeded its resource limit',
    });
  }
  if (expressions && state === '22012') {
    return domainError.validation({
      code: 'data_query.expression_division_by_zero',
      message: 'A data query expression divided by zero',
    });
  }
  if (expressions && state?.startsWith('22')) {
    return domainError.validation({
      code: 'data_query.expression_evaluation',
      message: 'Unable to evaluate a data query expression',
    });
  }
  return domainError.infrastructure({
    code: 'data_query.execution_failed',
    message: 'Unable to execute data query',
    ...(state ? { details: { sqlState: state } } : {}),
  });
};
