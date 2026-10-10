import { describe, expect, it, vi } from 'vitest';
vi.mock('@teable/db-main-prisma', () => ({ PrismaService: class {} }));
import { FieldReadonlyServiceAdapter } from './field-readonly.service';

describe('field snapshot-bulk coalesce', () => {
  const createCoalesced = (clsGet: (key: string) => unknown) => {
    const service = new FieldReadonlyServiceAdapter(
      { get: vi.fn((key: string) => clsGet(key)) } as never,
      {} as never
    );
    const axiosGet = vi.fn(async (_url: string, config?: { params?: { ids?: string[] } }) => ({
      data: (config?.params?.ids ?? []).map((id) => ({ id })),
    }));
    const http = { get: axiosGet };
    const adapter = service as unknown as { axios: typeof http }; // protected loopback client
    adapter.axios = http;
    return { service, axiosGet };
  };

  it('merges same-turn snapshot reads for one table and cookie into one HTTP call', async () => {
    const { service, axiosGet } = createCoalesced(() => undefined);
    const [first, second] = await Promise.all([
      service.getSnapshotBulk('tblTest', ['fldA']),
      service.getSnapshotBulk('tblTest', ['fldB', 'fldA']),
    ]);
    expect(axiosGet).toHaveBeenCalledTimes(1);
    expect(axiosGet.mock.calls[0]?.[0]).toBe('/table/tblTest/field/socket/snapshot-bulk');
    expect(axiosGet.mock.calls[0]?.[1]).toMatchObject({ params: { ids: ['fldA', 'fldB'] } });
    expect(first).toEqual([{ id: 'fldA' }]);
    expect(second).toEqual([{ id: 'fldB' }, { id: 'fldA' }]);
  });

  it('does not merge snapshot reads across cookies', async () => {
    let cookie = 'a';
    const { service, axiosGet } = createCoalesced((key) => (key === 'cookie' ? cookie : undefined));
    const first = service.getSnapshotBulk('tblTest', ['fldA']);
    cookie = 'b';
    const second = service.getSnapshotBulk('tblTest', ['fldB']);
    await Promise.all([first, second]);
    expect(axiosGet).toHaveBeenCalledTimes(2);
  });

  it('chunks merged ids to keep the query string bounded', async () => {
    const { service, axiosGet } = createCoalesced(() => undefined);
    const ids = Array.from({ length: 101 }, (_, index) => `fld${index}`);
    await service.getSnapshotBulk('tblTest', ids);
    expect(axiosGet).toHaveBeenCalledTimes(2);
    expect(axiosGet.mock.calls[0]?.[1]).toMatchObject({ params: { ids: ids.slice(0, 100) } });
    expect(axiosGet.mock.calls[1]?.[1]).toMatchObject({ params: { ids: ids.slice(100) } });
  });

  it('keeps the share-view snapshot URL', async () => {
    const { service, axiosGet } = createCoalesced((key) =>
      key === 'shareViewId' ? 'shrTest' : undefined
    );
    await service.getSnapshotBulk('tblTest', ['fldA']);
    expect(axiosGet).toHaveBeenCalledWith(
      '/share/shrTest/socket/field/snapshot-bulk',
      expect.objectContaining({ params: { ids: ['fldA'] } })
    );
  });

  it('reuses an in-flight snapshot read for the same identity and ids', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, axiosGet } = createCoalesced(() => undefined);
    axiosGet.mockImplementation(async (_url: string, config?: { params?: { ids?: string[] } }) => {
      await gate;
      return { data: (config?.params?.ids ?? []).map((id) => ({ id })) };
    });
    const first = service.getSnapshotBulk('tblTest', ['fldA', 'fldB']);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const second = service.getSnapshotBulk('tblTest', ['fldA']);
    release();
    const [firstSnapshots, secondSnapshots] = await Promise.all([first, second]);
    expect(axiosGet).toHaveBeenCalledTimes(1);
    expect(firstSnapshots).toEqual([{ id: 'fldA' }, { id: 'fldB' }]);
    expect(secondSnapshots).toEqual([{ id: 'fldA' }]);
  });

  it('does not emit an unhandled rejection when snapshot bulk fails', async () => {
    const { service, axiosGet } = createCoalesced(() => undefined);
    axiosGet.mockRejectedValue(new Error('503'));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      await expect(service.getSnapshotBulk('tblTest', ['fldA'])).rejects.toThrow('503');
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
