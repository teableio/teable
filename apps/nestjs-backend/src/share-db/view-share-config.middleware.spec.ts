import { describe, expect, it, vi } from 'vitest';
import { createViewShareConfigFilter } from './view-share-config.middleware';

const shareOp = () => ({
  v: 4,
  op: [
    { p: ['shareId'], oi: 'shrNewLink', od: 'shrOldLink' },
    { p: ['shareMeta'], oi: { allowEdit: true } },
    { p: ['enableShare'], oi: true },
  ],
});

const run = async (
  filter: ReturnType<typeof createViewShareConfigFilter>,
  context: Parameters<ReturnType<typeof createViewShareConfigFilter>>[0]
) => {
  await new Promise<void>((resolve) => filter(context, () => resolve()));
  return context.op;
};

describe('createViewShareConfigFilter', () => {
  it('passes the link and settings to a subscriber who manages the view share', async () => {
    const canRead = vi.fn().mockResolvedValue(true);
    const op = await run(createViewShareConfigFilter(canRead), {
      collection: 'viw_tblFixture',
      agent: { custom: { cookie: 'session' } },
      op: shareOp(),
    });
    expect(canRead).toHaveBeenCalledWith(expect.anything(), 'tblFixture');
    expect(op).toEqual(shareOp());
  });

  it('strips them for any other subscriber', async () => {
    const op = await run(createViewShareConfigFilter(vi.fn().mockResolvedValue(false)), {
      collection: 'viw_tblFixture',
      agent: { custom: { cookie: 'session' } },
      op: shareOp(),
    });
    expect(op).toEqual({ v: 4, op: [{ p: ['enableShare'], oi: true }] });
  });

  it('strips them too when the permission check fails', async () => {
    const op = await run(
      createViewShareConfigFilter(vi.fn().mockRejectedValue(new Error('down'))),
      {
        collection: 'viw_tblFixture',
        agent: { custom: {} },
        op: shareOp(),
      }
    );
    expect(op.op).toEqual([{ p: ['enableShare'], oi: true }]);
  });

  it('asks nothing for other documents or for view changes away from the share', async () => {
    const canRead = vi.fn().mockResolvedValue(false);
    const filter = createViewShareConfigFilter(canRead);
    const recordOp = await run(filter, {
      collection: 'rec_tblFixture',
      agent: { custom: {} },
      op: shareOp(),
    });
    await run(filter, {
      collection: 'viw_tblFixture',
      agent: { custom: {} },
      op: { v: 1, op: [{ p: ['name'], oi: 'Renamed' }] },
    });
    expect(canRead).not.toHaveBeenCalled();
    expect(recordOp).toEqual(shareOp());
  });
});
