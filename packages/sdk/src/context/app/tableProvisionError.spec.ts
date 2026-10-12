import { describe, expect, it } from 'vitest';
import { isTableProvisionPending } from './tableProvisionError';
describe('pending client classification', () => {
  it('recognizes domain codes, not generic 503 or missing errors', () => {
    expect(isTableProvisionPending({ data: { domainCode: 'table.provision_pending' } })).toBe(true);
    expect(isTableProvisionPending({ code: 'table.provision_pending' })).toBe(true);
    expect(isTableProvisionPending({ status: 503, message: 'Query is busy' })).toBe(false);
    expect(isTableProvisionPending({ code: 'table.not_found' })).toBe(false);
  });
});
