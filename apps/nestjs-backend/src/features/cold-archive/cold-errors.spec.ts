import { describe, expect, it } from 'vitest';
import { isMissingPartError, isTransientStorageFailure } from './cold-errors';

describe('cold error classification', () => {
  it('recognizes AWS SDK v3 service errors via name and $metadata', () => {
    const slowDown = Object.assign(new Error('Please reduce your request rate.'), {
      name: 'SlowDown',
      $metadata: { httpStatusCode: 503 },
    });
    expect(isTransientStorageFailure(slowDown)).toBe(true);

    const unnamed5xx = Object.assign(new Error('We encountered an internal error.'), {
      $metadata: { httpStatusCode: 500 },
    });
    expect(isTransientStorageFailure(unnamed5xx)).toBe(true);
  });

  it('still recognizes legacy code/statusCode fields and network errno codes', () => {
    expect(
      isTransientStorageFailure(Object.assign(new Error('slow down'), { code: 'SlowDown' }))
    ).toBe(true);
    expect(
      isTransientStorageFailure(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))
    ).toBe(true);
    expect(
      isTransientStorageFailure(Object.assign(new Error('bad gateway'), { statusCode: 502 }))
    ).toBe(true);
  });

  it('a missing part stays a defect, not a retry target', () => {
    const notFound = Object.assign(new Error('the specified key does not exist'), {
      name: 'NoSuchKey',
      $metadata: { httpStatusCode: 404 },
    });
    expect(isTransientStorageFailure(notFound)).toBe(false);
    expect(isMissingPartError(Object.assign(new Error('missing'), { name: 'NotFound' }))).toBe(
      true
    );
    expect(isTransientStorageFailure(new Error('malformed part key'))).toBe(false);
  });

  it('the DNS errno ENOTFOUND is transient, not a missing part', () => {
    const dns = Object.assign(new Error('getaddrinfo ENOTFOUND cold-minio.internal'), {
      code: 'ENOTFOUND',
    });
    expect(isMissingPartError(dns)).toBe(false);
    expect(isTransientStorageFailure(dns)).toBe(true);
  });
});
