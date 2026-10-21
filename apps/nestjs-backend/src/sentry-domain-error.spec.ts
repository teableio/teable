import type { ErrorEvent, EventHint } from '@sentry/nestjs';
import { HttpErrorCode } from '@teable/core';
import { domainError, toError } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';
import { CustomHttpException } from './custom.exception';
import { enrichSentryEventWithDomainError, getDomainErrorContext } from './sentry-domain-error';

const makeEvent = (): ErrorEvent =>
  ({
    type: undefined,
    exception: { values: [{ type: 'Error', value: 'original' }] },
  }) as ErrorEvent;

const hintFor = (exception: unknown): EventHint => ({ originalException: exception });

describe('getDomainErrorContext', () => {
  it('extracts from toError() output via the attached domainError', () => {
    const domain = domainError.infrastructure({
      message: 'Failed to load compute activity',
      details: { tableId: 'tbl1', error: 'connection refused' },
    });

    const context = getDomainErrorContext(toError(domain));

    expect(context).toEqual({
      code: 'infrastructure',
      message: 'Failed to load compute activity',
      detail: 'connection refused',
      tags: ['infrastructure'],
      details: { tableId: 'tbl1', error: 'connection refused' },
    });
  });

  it('extracts from a CustomHttpException via data.domainCode', () => {
    const exception = new CustomHttpException('bad field', HttpErrorCode.VALIDATION_ERROR, {
      domainCode: 'validation.field.invalid',
      domainTags: ['validation'],
      details: { field: 'name', error: { message: 'must not be empty' } },
    });

    const context = getDomainErrorContext(exception);

    expect(context).toEqual({
      code: 'validation.field.invalid',
      message: 'bad field',
      detail: 'must not be empty',
      tags: ['validation'],
      details: { field: 'name', error: { message: 'must not be empty' } },
    });
  });

  it('extracts from a raw DomainError POJO (Sentry unhandledRejection path)', () => {
    // Production still collapses into activeSpanWrapper when Sentry's
    // onUnhandledRejectionIntegration captures the DomainError POJO before our
    // process.on('unhandledRejection') toError() wrapper runs.
    const domain = domainError.infrastructure({
      message: 'Failed to load compute activity',
      details: { tableId: 'tbl1', error: 'Connection terminated due to connection timeout' },
    });

    const context = getDomainErrorContext(domain);

    expect(context).toEqual({
      code: 'infrastructure',
      message: 'Failed to load compute activity',
      detail: 'Connection terminated due to connection timeout',
      tags: ['infrastructure'],
      details: { tableId: 'tbl1', error: 'Connection terminated due to connection timeout' },
    });
  });

  it('returns undefined for non-domain exceptions', () => {
    expect(getDomainErrorContext(new Error('plain'))).toBeUndefined();
    expect(getDomainErrorContext('string reason')).toBeUndefined();
    expect(getDomainErrorContext(undefined)).toBeUndefined();
  });
});

describe('enrichSentryEventWithDomainError', () => {
  it('fingerprints by code + message only, keeping dynamic detail out', () => {
    const domain = domainError.infrastructure({
      message: 'Failed to load compute activity',
      details: { tableId: 'tbl1', error: 'relation "tbl_x9f2" does not exist' },
    });

    const event = enrichSentryEventWithDomainError(makeEvent(), hintFor(toError(domain)));

    expect(event.fingerprint).toEqual([
      'domain-error',
      'infrastructure',
      'Failed to load compute activity',
    ]);
    expect(event.transaction).toBe('infrastructure');
    expect(event.exception?.values?.[0]).toEqual({
      type: 'DomainError:infrastructure',
      value: 'Failed to load compute activity | relation "tbl_x9f2" does not exist',
    });
    // eslint-disable-next-line @typescript-eslint/naming-convention -- dot-separated Sentry tag key
    expect(event.tags).toEqual({ 'domain.error_code': 'infrastructure' });
    expect(event.extra).toEqual({
      domainTags: ['infrastructure'],
      domainDetails: { tableId: 'tbl1', error: 'relation "tbl_x9f2" does not exist' },
    });
  });

  it('retitles raw DomainError POJO rejections away from activeSpanWrapper', () => {
    const domain = domainError.infrastructure({
      message: 'Failed to load compute activity',
      details: { tableId: 'tbl1', error: 'timeout exceeded when trying to connect' },
    });

    const event = enrichSentryEventWithDomainError(makeEvent(), hintFor(domain));

    expect(event.fingerprint).toEqual([
      'domain-error',
      'infrastructure',
      'Failed to load compute activity',
    ]);
    expect(event.exception?.values?.[0]).toEqual({
      type: 'DomainError:infrastructure',
      value: 'Failed to load compute activity | timeout exceeded when trying to connect',
    });
  });

  it('retitles from extra.__serialized__ when originalException is missing', () => {
    const event = makeEvent();
    event.extra = {
      __serialized__: {
        code: 'infrastructure',
        message: 'Failed to load compute activity',
        tags: ['infrastructure'],
        details: { tableId: 'tbl1', error: 'Connection terminated due to connection timeout' },
      },
    };

    const enriched = enrichSentryEventWithDomainError(event, {});

    expect(enriched.fingerprint).toEqual([
      'domain-error',
      'infrastructure',
      'Failed to load compute activity',
    ]);
    expect(enriched.exception?.values?.[0]).toEqual({
      type: 'DomainError:infrastructure',
      value: 'Failed to load compute activity | Connection terminated due to connection timeout',
    });
  });

  it('captures domainDetails from CustomHttpException data', () => {
    const exception = new CustomHttpException('boom', HttpErrorCode.INTERNAL_SERVER_ERROR, {
      domainCode: 'infrastructure',
      domainTags: ['infrastructure'],
      details: { tableId: 'tbl1' },
    });

    const event = enrichSentryEventWithDomainError(makeEvent(), hintFor(exception));

    expect(event.extra).toEqual({
      domainTags: ['infrastructure'],
      domainDetails: { tableId: 'tbl1' },
    });
  });

  it('keeps an existing transaction name', () => {
    const domain = domainError.validation({ message: 'bad field' });
    const event = makeEvent();
    event.transaction = 'POST /api/table';

    const enriched = enrichSentryEventWithDomainError(event, hintFor(toError(domain)));

    expect(enriched.transaction).toBe('POST /api/table');
    expect(enriched.fingerprint).toEqual(['domain-error', 'validation.invalid', 'bad field']);
  });

  it('leaves non-domain events untouched', () => {
    const event = makeEvent();

    const enriched = enrichSentryEventWithDomainError(event, hintFor(new Error('plain')));

    expect(enriched).toBe(event);
    expect(enriched.fingerprint).toBeUndefined();
    expect(enriched.exception?.values?.[0]).toEqual({ type: 'Error', value: 'original' });
  });
});
