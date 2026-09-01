import type { SdkErrorI18nKey } from '@teable/i18n-keys';

/**
 * Domain Error Tags
 *
 * These tags categorize errors by their semantic meaning and help downstream
 * handlers (e.g., HTTP adapters) translate domain errors into appropriate responses.
 *
 * Tag definitions and boundaries:
 *
 * - `validation`: Input data fails schema or business rule validation.
 *   Boundary: Use when user-provided data is malformed, out of range, or violates
 *   format constraints. This is a client-side fixable issue.
 *
 * - `conflict`: Operation cannot proceed due to state collision (e.g., duplicate name).
 *   Boundary: Use when the requested change conflicts with existing data. The client
 *   may retry with different values.
 *
 * - `not-found`: Requested resource does not exist.
 *   Boundary: Use when a lookup by ID, name, or spec yields no result. Typically
 *   maps to HTTP 404.
 *
 * - `invariant`: Domain invariant or business rule violation detected.
 *   Boundary: Use when an operation would put the domain in an invalid state
 *   (e.g., deleting the last primary field, circular reference). This indicates
 *   a logical constraint violation, not a simple validation error.
 *
 * - `not-implemented`: Feature or code path is not yet implemented.
 *   Boundary: Use as a placeholder during development. Should not appear in
 *   production; if it does, treat it as a bug.
 *
 * - `unauthorized`: Authentication is missing or invalid.
 *   Boundary: Use when the caller has not provided valid credentials or tokens.
 *   Typically maps to HTTP 401.
 *
 * - `forbidden`: Caller is authenticated but lacks permission.
 *   Boundary: Use when the caller's identity is known but they do not have
 *   sufficient rights for the requested operation. Typically maps to HTTP 403.
 *
 * - `infrastructure`: External system or infrastructure failure.
 *   Boundary: Use for database connection errors, network timeouts, third-party
 *   service failures, etc. The domain logic is correct but the underlying
 *   infrastructure is unavailable.
 *
 * - `unexpected`: Catch-all for unknown or unclassified errors.
 *   Boundary: Use when the error doesn't fit other categories or when wrapping
 *   unknown exceptions. Investigate these as potential bugs.
 */
export const domainErrorTagValues = [
  'validation',
  'conflict',
  'not-found',
  'invariant',
  'not-implemented',
  'unauthorized',
  'forbidden',
  'infrastructure',
  'unexpected',
] as const;

export type DomainErrorTag = (typeof domainErrorTagValues)[number];

/**
 * Error code for programmatic identification.
 * Convention: use dot-separated namespaces (e.g., "validation.field.name_empty").
 */
export type DomainErrorCode = string;

/**
 * User-facing translation attached where the error is created.
 * `i18nKey` selects a message in the frontend `sdk` locale namespace and
 * `context` must cover every interpolation placeholder of that message —
 * a site that cannot supply the placeholders must omit `localization`
 * entirely so the client falls back to the English `message`.
 */
export interface IDomainErrorLocalization {
  readonly i18nKey: SdkErrorI18nKey;
  readonly context?: Readonly<Record<string, unknown>>;
}

/**
 * DomainError - A structured, serializable error representation for domain layer.
 *
 * Design decisions:
 * - Plain data object (not extending Error) to remain serializable across boundaries.
 * - No throw/exception semantics; errors are returned via Result<T, DomainError>.
 * - Immutable (all fields readonly) for predictable behavior.
 * - Diagnostic `stack`/`cause` are non-enumerable so JSON/HTTP DTO paths stay clean,
 *   while Sentry and log boundaries can still attribute the creation site.
 *
 * Fields:
 * - `code`: Machine-readable identifier for error type (e.g., "validation.field.invalid").
 * - `message`: Human-readable description suitable for logging or display.
 * - `tags`: Array of semantic tags for categorization and HTTP status mapping.
 * - `details`: Optional structured metadata (e.g., field name, expected vs actual values).
 * - `localization`: Optional user-facing translation, attached at the throw site.
 * - `stack`: Optional creation-site stack (non-enumerable diagnostic).
 * - `cause`: Optional original thrown value when wrapping unknowns (non-enumerable).
 */
export interface DomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly tags: ReadonlyArray<DomainErrorTag>;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly localization?: IDomainErrorLocalization;
  readonly stack?: string;
  readonly cause?: unknown;
  toString(): string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type DomainErrorInput = {
  code: DomainErrorCode;
  message: string;
  tags: ReadonlyArray<DomainErrorTag>;
  details?: Readonly<Record<string, unknown>>;
  localization?: IDomainErrorLocalization;
  stack?: string;
  cause?: unknown;
};

const defineNonEnumerable = (target: object, key: string, value: unknown): void => {
  Object.defineProperty(target, key, {
    value,
    enumerable: false,
    configurable: true,
    writable: true,
  });
};

const attachCreationStack = (
  error: DomainError,
  constructorOpt: (...args: never[]) => unknown
): void => {
  if (typeof Error.captureStackTrace === 'function') {
    // V8 keeps the stack lazy: the string is only materialized when `stack` is
    // read (Sentry/log boundaries), so hot validation paths don't pay for it.
    // Passing the public factory as `constructorOpt` already trims every
    // DomainError-internal frame, in source and compiled output alike.
    Error.captureStackTrace(error, constructorOpt);
    return;
  }
  const fallback = new Error(error.message).stack;
  if (fallback) {
    defineNonEnumerable(error, 'stack', fallback);
  }
};

/**
 * Internal factory to create a DomainError object.
 * `constructorOpt` is the outermost factory frame to omit from the captured stack
 * (the public factory itself, e.g. `domainError.validation`) so Sentry
 * attributes the real call site.
 */
function createError(
  input: DomainErrorInput,
  constructorOpt: (...args: never[]) => unknown = createError
): DomainError {
  const error: DomainError = {
    code: input.code,
    message: input.message,
    tags: input.tags,
    details: input.details,
    localization: input.localization,
    toString: () => input.message,
  };

  if (input.stack) {
    defineNonEnumerable(error, 'stack', input.stack);
  } else {
    attachCreationStack(error, constructorOpt);
  }

  if (input.cause !== undefined) {
    defineNonEnumerable(error, 'cause', input.cause);
  }

  return error;
}

type DomainErrorParams = {
  message: string;
  code?: DomainErrorCode;
  details?: Readonly<Record<string, unknown>>;
  tags?: ReadonlyArray<DomainErrorTag>;
  localization?: IDomainErrorLocalization;
  cause?: unknown;
};

/**
 * Internal helper to merge base tags with user-provided params.
 * Ensures the primary tag is always present and deduplicates.
 */
function withTags(
  tags: ReadonlyArray<DomainErrorTag>,
  params: DomainErrorParams,
  constructorOpt: (...args: never[]) => unknown = withTags
): DomainError {
  return createError(
    {
      code: params.code ?? tags[0] ?? 'unexpected',
      message: params.message,
      tags: params.tags ? [...new Set([...tags, ...params.tags])] : tags,
      details: params.details,
      localization: params.localization,
      cause: params.cause,
    },
    constructorOpt
  );
}

// ---------------------------------------------------------------------------
// Domain Error Factory
// ---------------------------------------------------------------------------

/**
 * Factory object for creating DomainError instances.
 *
 * Usage guidelines:
 * - Prefer explicit factory methods (validation, conflict, etc.).
 * - Always provide a descriptive message for debugging and logging.
 * - Use `details` to attach structured context (field names, IDs, constraints).
 *
 * @example
 * ```ts
 * // Validation error with custom code
 * domainError.validation({
 *   message: 'Field name cannot be empty',
 *   code: 'validation.field.name_empty',
 *   details: { fieldType: 'text' },
 * });
 *
 * // Not found error
 * domainError.notFound({
 *   message: `Table with ID ${tableId} not found`,
 *   details: { tableId },
 * });
 * ```
 */
export const domainError = {
  /**
   * Input validation failure.
   * Use when: User-provided data is invalid (format, range, type mismatch).
   * HTTP mapping: 400 Bad Request
   */
  validation: (params: DomainErrorParams): DomainError =>
    withTags(
      ['validation'],
      { code: params.code ?? 'validation.invalid', ...params },
      domainError.validation
    ),

  /**
   * State conflict (duplicate, already exists).
   * Use when: Operation conflicts with existing data (e.g., duplicate name).
   * HTTP mapping: 409 Conflict
   */
  conflict: (params: DomainErrorParams): DomainError =>
    withTags(['conflict'], { code: params.code ?? 'conflict', ...params }, domainError.conflict),

  /**
   * Resource not found.
   * Use when: Requested entity does not exist in the system.
   * HTTP mapping: 404 Not Found
   */
  notFound: (params: DomainErrorParams): DomainError =>
    withTags(['not-found'], { code: params.code ?? 'not_found', ...params }, domainError.notFound),

  /**
   * Domain invariant violation.
   * Use when: Operation would break business rules or domain constraints.
   * Examples: Deleting primary field, circular dependency, invalid state transition.
   * HTTP mapping: 422 Unprocessable Entity (or 400 depending on context)
   */
  invariant: (params: DomainErrorParams): DomainError =>
    withTags(
      ['invariant'],
      { code: params.code ?? 'invariant.violation', ...params },
      domainError.invariant
    ),

  /**
   * Feature not implemented.
   * Use when: Code path exists but implementation is pending.
   * Note: Should not appear in production; treat as a bug if encountered.
   * HTTP mapping: 501 Not Implemented
   */
  notImplemented: (params: DomainErrorParams): DomainError =>
    withTags(
      ['not-implemented'],
      { code: params.code ?? 'not_implemented', ...params },
      domainError.notImplemented
    ),

  /**
   * Authentication failure.
   * Use when: Caller has not provided valid credentials or token.
   * HTTP mapping: 401 Unauthorized
   */
  unauthorized: (params: DomainErrorParams): DomainError =>
    withTags(
      ['unauthorized'],
      { code: params.code ?? 'unauthorized', ...params },
      domainError.unauthorized
    ),

  /**
   * Authorization failure (authenticated but not permitted).
   * Use when: Caller's identity is known but lacks permission for the operation.
   * HTTP mapping: 403 Forbidden
   */
  forbidden: (params: DomainErrorParams): DomainError =>
    withTags(['forbidden'], { code: params.code ?? 'forbidden', ...params }, domainError.forbidden),

  /**
   * Infrastructure or external service failure.
   * Use when: Database, network, third-party API, or other infra component fails.
   * Note: Domain logic is correct; the underlying system is unavailable.
   * HTTP mapping: 503 Service Unavailable (or 500)
   */
  infrastructure: (params: DomainErrorParams): DomainError =>
    withTags(
      ['infrastructure'],
      { code: params.code ?? 'infrastructure', ...params },
      domainError.infrastructure
    ),

  /**
   * Catch-all for unclassified errors.
   * Use when: Error doesn't fit other categories or source is unknown.
   * Note: Investigate these as potential bugs; aim to replace with specific types.
   * HTTP mapping: 500 Internal Server Error
   */
  unexpected: (params: DomainErrorParams): DomainError =>
    withTags(
      ['unexpected'],
      { code: params.code ?? 'unexpected', ...params },
      domainError.unexpected
    ),

  /**
   * Wrap unknown errors (e.g., caught exceptions) into DomainError.
   * If the error is already a DomainError, returns it unchanged.
   *
   * Use at system boundaries to normalize error types.
   * When wrapping a real Error, preserves its stack as the diagnostic stack and
   * keeps the original value on non-enumerable `cause`.
   */
  fromUnknown: (error: unknown, params?: Omit<DomainErrorParams, 'message'>): DomainError => {
    if (isDomainError(error)) {
      return error;
    }
    if (error instanceof Error) {
      // Errors produced by toError() carry the original DomainError; unwrap it
      // so a toError -> fromUnknown round trip is lossless (code, tags, details).
      const unwrapped = (error as { domainError?: unknown }).domainError;
      if (isDomainError(unwrapped)) {
        return unwrapped;
      }
      return createError(
        {
          code: params?.code ?? 'unexpected',
          message: error.message ? error.message : error.name || String(error),
          tags: params?.tags
            ? [...new Set<DomainErrorTag>(['unexpected', ...params.tags])]
            : ['unexpected'],
          details: params?.details,
          localization: params?.localization,
          stack: error.stack,
          cause: error,
        },
        domainError.fromUnknown
      );
    }
    return withTags(
      ['unexpected'],
      {
        message: String(error),
        code: params?.code ?? 'unexpected',
        details: params?.details,
        tags: params?.tags,
        localization: params?.localization,
        cause: error,
      },
      domainError.fromUnknown
    );
  },

  /**
   * Convert a DomainError into a real Error for throw/Sentry boundaries.
   * Domain code still returns Result; only adapters should call this.
   */
  toError: (error: DomainError): Error => toError(error),
};

// ---------------------------------------------------------------------------
// Type Guards and Utilities
// ---------------------------------------------------------------------------

/**
 * Type guard to check if an unknown value is a DomainError.
 * Useful for handling errors at boundaries or in catch blocks.
 */
export const isDomainError = (error: unknown): error is DomainError => {
  // DomainError is intentionally a POJO, never a real Error. Rejecting Error
  // instances keeps boundary wrappers from toError()/HttpException out of
  // Result paths and fromUnknown passthrough.
  if (!error || typeof error !== 'object' || error instanceof Error) return false;
  const candidate = error as DomainError;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    Array.isArray(candidate.tags)
  );
};

/**
 * Check if error has a specific tag.
 */
export const hasTag = (error: DomainError, tag: DomainErrorTag): boolean =>
  error.tags.includes(tag);

/**
 * Check if error has a specific code.
 * Useful for programmatic error handling based on error codes.
 */
export const hasCode = (error: DomainError, code: DomainErrorCode): boolean => error.code === code;

/**
 * Convert a DomainError into a real Error for HTTP/Sentry/unhandled boundaries.
 *
 * Domain code still returns Result; only adapters that must throw or report to
 * exception trackers should call this.
 */
export const toError = (error: DomainError): Error => {
  const exception = new Error(error.message);
  // Plain assignment would make `name` an enumerable own property; keep it
  // non-enumerable like a native Error's.
  defineNonEnumerable(exception, 'name', `DomainError:${error.code}`);
  if (error.stack) {
    exception.stack = error.stack;
  }
  // Non-enumerable like the DomainError diagnostics: Sentry and boundary code
  // read these by property access, while JSON serialization of the Error stays
  // clean (a bare Error stringifies to `{}`).
  defineNonEnumerable(exception, 'code', error.code);
  defineNonEnumerable(exception, 'tags', error.tags);
  defineNonEnumerable(exception, 'details', error.details);
  defineNonEnumerable(exception, 'localization', error.localization);
  defineNonEnumerable(exception, 'domainError', error);
  if (error.cause !== undefined) {
    defineNonEnumerable(exception, 'cause', error.cause);
  }
  return exception;
};

// ---------------------------------------------------------------------------
// Convenience Type Predicates
// ---------------------------------------------------------------------------
// These functions provide semantic clarity when checking error types.
// Use them in conditional logic to determine appropriate error handling.

/** Check if error is a validation error (bad input from client). */
export const isValidationError = (error: DomainError): boolean => hasTag(error, 'validation');

/** Check if error is a conflict error (state collision). */
export const isConflictError = (error: DomainError): boolean => hasTag(error, 'conflict');

/** Check if error is a not-found error (resource doesn't exist). */
export const isNotFoundError = (error: DomainError): boolean => hasTag(error, 'not-found');

/** Check if error is an invariant violation (domain rule broken). */
export const isInvariantError = (error: DomainError): boolean => hasTag(error, 'invariant');

/** Check if error is not-implemented (feature pending). */
export const isNotImplementedError = (error: DomainError): boolean =>
  hasTag(error, 'not-implemented');

/** Check if error is unauthorized (authentication failure). */
export const isUnauthorizedError = (error: DomainError): boolean => hasTag(error, 'unauthorized');

/** Check if error is forbidden (authorization failure). */
export const isForbiddenError = (error: DomainError): boolean => hasTag(error, 'forbidden');

/** Check if error is infrastructure-related (external system failure). */
export const isInfrastructureError = (error: DomainError): boolean =>
  hasTag(error, 'infrastructure');

/** Check if error is unexpected/unclassified (potential bug). */
export const isUnexpectedError = (error: DomainError): boolean => hasTag(error, 'unexpected');
