import { domainError } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';
import { mapDomainErrorToHttpStatus } from './http';
describe('pending HTTP contract', () => {
  it('maps pending explicitly to 503, including legacy not-found errors', () => {
    for (const factory of [domainError.infrastructure, domainError.notFound]) {
      expect(
        mapDomainErrorToHttpStatus(
          factory({ code: 'table.provision_pending', message: 'Updating' })
        )
      ).toBe(503);
    }
    expect(
      mapDomainErrorToHttpStatus(
        domainError.notFound({ code: 'table.not_found', message: 'Missing' })
      )
    ).toBe(404);
    expect(mapDomainErrorToHttpStatus(domainError.infrastructure({ message: 'Broken' }))).toBe(500);
  });
});
