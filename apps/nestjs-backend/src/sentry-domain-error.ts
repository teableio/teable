import type { ErrorEvent, EventHint } from '@sentry/nestjs';
import { isDomainError } from '@teable/v2-core';

export interface IDomainErrorEventContext {
  code?: string;
  message?: string;
  detail?: string;
  tags?: unknown;
  details?: unknown;
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const describeDomainErrorDetail = (details: unknown): string | undefined => {
  if (!details || typeof details !== 'object') return undefined;
  const nested = (details as Record<string, unknown>).error;
  if (typeof nested === 'string' && nested.trim()) return nested.trim();
  if (nested && typeof nested === 'object') {
    const nestedMessage = asString((nested as { message?: unknown }).message);
    if (nestedMessage?.trim()) return nestedMessage.trim();
  }
  return undefined;
};

type ICandidate = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  tags?: unknown;
  details?: unknown;
  data?: { domainCode?: unknown; domainTags?: unknown; details?: unknown };
  domainError?: { code?: unknown; message?: unknown; tags?: unknown; details?: unknown };
};

/** toError() output carries the original DomainError POJO. */
const contextFromAttachedDomainError = (
  candidate: ICandidate
): IDomainErrorEventContext | undefined => {
  const domain = candidate.domainError;
  if (!domain || typeof domain !== 'object') return undefined;
  return {
    code: asString(domain.code),
    message: asString(domain.message),
    detail: describeDomainErrorDetail(domain.details),
    tags: domain.tags,
    details: domain.details,
  };
};

/** A real Error named by toError() but without the attached POJO. */
const contextFromNamedError = (candidate: ICandidate): IDomainErrorEventContext | undefined => {
  const name = asString(candidate.name);
  if (!name?.startsWith('DomainError:')) return undefined;
  return {
    code: asString(candidate.code) ?? name.slice('DomainError:'.length),
    message: asString(candidate.message),
    detail: describeDomainErrorDetail(candidate.details),
    tags: candidate.tags,
    details: candidate.details,
  };
};

/** CustomHttpException thrown by throwV2Error carries `data.domainCode`. */
const contextFromHttpExceptionData = (
  candidate: ICandidate
): IDomainErrorEventContext | undefined => {
  const data = candidate.data;
  if (!data || typeof data.domainCode !== 'string') return undefined;
  return {
    code: data.domainCode,
    message: asString(candidate.message),
    detail: describeDomainErrorDetail(data.details),
    tags: data.domainTags,
    details: data.details,
  };
};

/**
 * Raw DomainError POJO — the shape Sentry's onUnhandledRejectionIntegration
 * still sees when it races ahead of bootstrap's toError() wrapper.
 */
const contextFromDomainErrorPojo = (exception: unknown): IDomainErrorEventContext | undefined => {
  if (!isDomainError(exception)) return undefined;
  return {
    code: exception.code,
    message: exception.message,
    detail: describeDomainErrorDetail(exception.details),
    tags: exception.tags,
    details: exception.details,
  };
};

/**
 * Extract DomainError attribution from the shapes that reach Sentry:
 * toError() output (carries `domainError`), a DomainError-named Error,
 * CustomHttpException (carries `data.domainCode`), and the raw DomainError
 * POJO captured directly by Sentry's unhandledRejection integration.
 */
export const getDomainErrorContext = (exception: unknown): IDomainErrorEventContext | undefined => {
  if (!exception || typeof exception !== 'object') return undefined;
  const candidate = exception as ICandidate;
  return (
    contextFromAttachedDomainError(candidate) ??
    contextFromNamedError(candidate) ??
    contextFromHttpExceptionData(candidate) ??
    contextFromDomainErrorPojo(exception)
  );
};

const retitleException = (event: ErrorEvent, domain: IDomainErrorEventContext): void => {
  const value = event.exception?.values?.[0];
  if (!value) return;
  value.type = domain.code ? `DomainError:${domain.code}` : value.type;
  value.value = [domain.message, domain.detail].filter(Boolean).join(' | ') || value.value;
};

/**
 * Sentry beforeSend hook: fingerprint and retitle DomainError events so they
 * group by failure kind instead of Sentry's activeSpanWrapper fallback.
 *
 * The fingerprint uses `code` + `message` only. `details.error` frequently
 * carries dynamic identifiers (record ids, relation names, driver text), which
 * would split one failure kind into unbounded Sentry issues — it is kept on the
 * displayed value and `extra.domainDetails` instead.
 */
export const enrichSentryEventWithDomainError = (
  event: ErrorEvent,
  hint: EventHint
): ErrorEvent => {
  // Prefer hint.originalException (the value passed to captureException). Fall
  // back to extra.__serialized__: when Sentry captures a non-Error POJO it
  // mirrors the object there, which is what production activeSpanWrapper events
  // still show for escaped DomainErrors.
  const domain =
    getDomainErrorContext(hint.originalException ?? hint.syntheticException) ??
    getDomainErrorContext(event.extra?.__serialized__);
  if (!domain?.code && !domain?.message) {
    return event;
  }

  const fingerprintParts = [domain.code, domain.message].filter(
    (part): part is string => typeof part === 'string' && part.length > 0
  );
  if (fingerprintParts.length > 0) {
    event.fingerprint = ['domain-error', ...fingerprintParts];
    // Prefer a stable, informative title over Sentry's activeSpanWrapper fallback.
    event.transaction = event.transaction ?? fingerprintParts[0];
    retitleException(event, domain);
  }

  if (domain.code) {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- dot-separated Sentry tag key
    event.tags = { ...event.tags, 'domain.error_code': domain.code };
  }
  if (domain.tags !== undefined || domain.details !== undefined) {
    event.extra = {
      ...event.extra,
      ...(domain.tags !== undefined ? { domainTags: domain.tags } : {}),
      ...(domain.details !== undefined ? { domainDetails: domain.details } : {}),
    };
  }
  return event;
};
