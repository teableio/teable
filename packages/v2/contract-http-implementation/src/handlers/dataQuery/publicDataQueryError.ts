import {
  domainError,
  isConflictError,
  isForbiddenError,
  isNotFoundError,
  isUnauthorizedError,
  isValidationError,
  type DomainError,
} from '@teable/v2-core';

/** Repository and plugin failures may carry private driver diagnostics. */
export const publicDataQueryError = (error: DomainError, operation: 'execute' | 'explain') => {
  if (error.code === 'data_query.cursor_not_configured') {
    return domainError.infrastructure({
      code: error.code,
      message:
        'Data query cursor signing requires a private SECRET_KEY, BACKEND_JWT_SECRET, or BACKEND_SESSION_SECRET on the server. Embedded hosts must supply cursorSigningKey.',
    });
  }
  if (error.code === 'data_query.timeout') {
    return domainError.infrastructure({
      code: error.code,
      message: 'Data query exceeded its statement timeout',
      cause: error,
    });
  }
  if (
    isValidationError(error) ||
    isUnauthorizedError(error) ||
    isForbiddenError(error) ||
    isNotFoundError(error) ||
    isConflictError(error)
  )
    return error;
  return domainError.unexpected({
    code: operation === 'execute' ? 'data_query.execution_failed' : 'data_query.explain_failed',
    message: `Unable to ${operation} data query`,
    cause: error,
  });
};
