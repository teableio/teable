import { ActorId, TableByIdSpec, TableId } from '@teable/v2-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostgresTableRepository } from './PostgresTableRepository';

const fixture = () => {
  const repository = Object.create(PostgresTableRepository.prototype);
  const probe = vi.fn<() => Promise<'pending' | 'ready' | 'missing'>>();
  repository.probeActiveTableProvisionState = probe;
  const load = vi.fn<() => Promise<{ id: string } | undefined>>();
  const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
  const spec = TableByIdSpec.create(TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap());
  return {
    probe,
    load,
    run: (waitMs = 250) =>
      repository.loadActiveTableRow(context, spec, { provisionWaitMs: waitMs }, load, 'active'),
    ready: (waitMs = 250) => repository.waitForReady(context, spec, { provisionWaitMs: waitMs }),
  };
};

afterEach(() => vi.useRealTimers());

describe('table provisioning wait', () => {
  it('only hydrates initially while pending, using one deadline', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.load.mockResolvedValue(undefined);
    f.probe.mockResolvedValue('pending');
    const promise = f.run();
    await vi.advanceTimersByTimeAsync(250);
    expect(await promise).toMatchObject({ provisionPending: true, pendingWaitExpiredMs: 250 });
    expect(f.load).toHaveBeenCalledTimes(1);
    expect(f.probe).toHaveBeenCalledTimes(4);
  });

  it('reprobes a ready/load-miss race without resetting the budget', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.load.mockResolvedValue(undefined);
    f.probe.mockResolvedValueOnce('ready').mockResolvedValue('pending');
    const promise = f.run();
    await vi.advanceTimersByTimeAsync(250);
    expect(await promise).toMatchObject({ provisionPending: true, pendingWaitExpiredMs: 250 });
    expect(f.load).toHaveBeenCalledTimes(2);
    expect(f.probe).toHaveBeenCalledTimes(5);
  });

  it('loads again only when ready', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.load.mockResolvedValueOnce(undefined).mockResolvedValue({ id: 'ready' });
    f.probe.mockResolvedValueOnce('pending').mockResolvedValue('ready');
    const promise = f.run();
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toEqual({ row: { id: 'ready' } });
    expect(f.load).toHaveBeenCalledTimes(2);
  });

  it('zero wait still distinguishes pending from missing', async () => {
    const f = fixture();
    f.load.mockResolvedValue(undefined);
    f.probe.mockResolvedValue('pending');
    expect(await f.run(0)).toMatchObject({ provisionPending: true });
    f.probe.mockResolvedValue('missing');
    expect(await f.run(0)).toEqual({ row: undefined });
  });

  it('pure readiness never hydrates and returns a retryable code', async () => {
    const f = fixture();
    f.probe.mockResolvedValue('pending');
    const result = await f.ready(0);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'table.provision_pending',
      tags: ['infrastructure'],
    });
    expect(result._unsafeUnwrapErr().message).not.toContain('Table not found');
    expect(f.load).not.toHaveBeenCalled();
  });
});
