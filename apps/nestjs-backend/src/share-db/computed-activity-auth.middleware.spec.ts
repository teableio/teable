import { describe, expect, it, vi } from 'vitest';
import { computedActivityAuthMiddleware } from './computed-activity-auth.middleware';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('computed activity live authorization', () => {
  it('batches same-turn field ops and rechecks the next batch after revocation', async () => {
    const use = vi.fn();
    const authorizeComputedActivityDocuments = vi.fn().mockResolvedValue(undefined);
    computedActivityAuthMiddleware({ use } as never, { authorizeComputedActivityDocuments });
    const handler = use.mock.calls[0][1];
    const agent = { custom: { cookie: 'session' } };
    const first = vi.fn();
    const second = vi.fn();
    handler({ collection: 'cmp_tblTest', id: 'fldOne', agent }, first);
    handler({ collection: 'cmp_tblTest', id: 'fldTwo', agent }, second);
    await flush();
    expect(authorizeComputedActivityDocuments).toHaveBeenCalledTimes(1);
    expect(authorizeComputedActivityDocuments).toHaveBeenCalledWith(
      'tblTest',
      ['fldOne', 'fldTwo'],
      { agentCustom: agent.custom }
    );
    expect(first).toHaveBeenCalledWith();
    authorizeComputedActivityDocuments.mockRejectedValueOnce(new Error('revoked'));
    const revoked = vi.fn();
    handler({ collection: 'cmp_tblTest', id: 'fldOne', agent }, revoked);
    await flush();
    expect(authorizeComputedActivityDocuments).toHaveBeenCalledTimes(2);
    expect(revoked).toHaveBeenCalledWith(expect.any(Error));
  });
});
