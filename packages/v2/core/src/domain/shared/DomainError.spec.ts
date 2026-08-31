import { describe, expect, it } from 'vitest';

import { domainError, isDomainError, toError } from './DomainError';

describe('DomainError diagnostics', () => {
  it('captures a non-enumerable creation-site stack', () => {
    const error = domainError.infrastructure({
      message: 'Failed to load compute activity',
      details: { tableId: 'tbl1', error: 'relation does not exist' },
    });

    expect(error.stack).toEqual(expect.stringContaining('DomainError.spec.ts'));
    expect(error.stack).not.toEqual(expect.stringContaining('at withTags'));
    expect(Object.keys(error)).not.toContain('stack');
    expect(JSON.stringify(error)).not.toContain('stack');
    expect(JSON.parse(JSON.stringify(error))).toMatchObject({
      code: 'infrastructure',
      message: 'Failed to load compute activity',
      tags: ['infrastructure'],
      details: { tableId: 'tbl1', error: 'relation does not exist' },
    });
  });

  it('preserves the original Error stack via fromUnknown', () => {
    const original = new Error('db unavailable');
    const wrapped = domainError.fromUnknown(original, {
      code: 'infrastructure.db',
      tags: ['infrastructure'],
    });

    expect(isDomainError(wrapped)).toBe(true);
    expect(wrapped.code).toBe('infrastructure.db');
    expect(wrapped.tags).toEqual(['unexpected', 'infrastructure']);
    expect(wrapped.stack).toBe(original.stack);
    expect(wrapped.cause).toBe(original);
    expect(Object.keys(wrapped)).not.toContain('cause');
  });

  it('converts to a real Error for throw/Sentry boundaries', () => {
    const domain = domainError.validation({
      code: 'validation.field.invalid',
      message: 'bad field',
    });
    const exception = toError(domain);

    expect(exception).toBeInstanceOf(Error);
    expect(exception.name).toBe('DomainError:validation.field.invalid');
    expect(exception.message).toBe('bad field');
    expect(exception.stack).toBe(domain.stack);
    expect((exception as Error & { code: string }).code).toBe('validation.field.invalid');
    expect((exception as Error & { domainError: unknown }).domainError).toBe(domain);
    expect(isDomainError(exception)).toBe(false);

    // Domain payload stays non-enumerable so serialized Errors don't leak it.
    expect(Object.keys(exception)).toEqual([]);
    expect(JSON.stringify(exception)).toBe('{}');

    // toError -> fromUnknown round trip is lossless: the original DomainError
    // is unwrapped, preserving code/tags/details.
    expect(domainError.fromUnknown(exception)).toBe(domain);
  });
});
