import { COMPUTE_PAUSED_WRITE_BLOCKED_CODE, domainError } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { mapDomainErrorToHttpError, mapDomainErrorToHttpStatus } from './http';

describe('v2 domain error to http', () => {
  it('maps a statement timeout to a retryable dependency timeout instead of 500', () => {
    const timeout = domainError.infrastructure({
      code: 'db.statement_timeout',
      message: 'Failed to load table records: canceling statement due to statement timeout',
      details: { pgCode: '57014' },
    });

    expect(mapDomainErrorToHttpStatus(timeout)).toBe(504);
    expect(mapDomainErrorToHttpError(timeout)).toMatchObject({
      code: 'db.statement_timeout',
      tags: ['infrastructure'],
      details: { pgCode: '57014' },
    });
  });

  it('keeps other database query failures internal', () => {
    const missingColumn = domainError.unexpected({
      code: 'db.undefined_column',
      message: 'Failed to load table records: column "missing" does not exist',
      details: { pgCode: '42703' },
    });

    expect(mapDomainErrorToHttpStatus(missingColumn)).toBe(500);
  });

  it('keeps the tag based mapping for every other status', () => {
    expect(mapDomainErrorToHttpStatus(domainError.notFound({ message: 'missing' }))).toBe(404);
    expect(mapDomainErrorToHttpStatus(domainError.validation({ message: 'bad input' }))).toBe(400);
    expect(mapDomainErrorToHttpStatus(domainError.conflict({ message: 'taken' }))).toBe(400);
    expect(
      mapDomainErrorToHttpStatus(
        domainError.conflict({ code: COMPUTE_PAUSED_WRITE_BLOCKED_CODE, message: 'paused' })
      )
    ).toBe(409);
    expect(mapDomainErrorToHttpStatus(domainError.unexpected({ message: 'boom' }))).toBe(500);
  });
});
