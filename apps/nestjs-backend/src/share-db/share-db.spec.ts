import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { IdPrefix } from '@teable/core';
import ShareDB from 'sharedb';
import { vi } from 'vitest';
import { authMiddleware, INTERNAL_SHAREDB_CONNECTION } from './auth.middleware';
import { GlobalModule } from '../global/global.module';
import { RawOpType } from './interface';
import { ShareDbAdapter } from './share-db.adapter';
import { ShareDbModule } from './share-db.module';
import { ShareDbService } from './share-db.service';

describe('ShareDb', () => {
  let provider: ShareDbService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [GlobalModule, ShareDbModule],
    }).compile();

    provider = module.get<ShareDbService>(ShareDbService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  it('returns empty snapshots for stale query ids missing from snapshot bulk', async () => {
    const cls = {
      get: vi.fn(() => undefined),
      runWith: vi.fn((_store, fn) => fn()),
    };
    const recordService = {
      getSnapshotBulk: vi.fn().mockResolvedValue([
        {
          id: 'recExisting',
          v: 2,
          type: 'json0',
          data: { id: 'recExisting', fields: {} },
        },
      ]),
    };
    const adapter = new ShareDbAdapter(
      cls as never,
      {} as never,
      recordService as never,
      {} as never,
      {} as never,
      {} as never
    );

    const snapshots = await new Promise<
      Record<string, { v: number; type: string | null; data?: unknown }>
    >((resolve, reject) => {
      adapter.getSnapshotBulk(
        `${IdPrefix.Record}_tblTest`,
        ['recExisting', 'recDeleted'],
        undefined,
        { cookie: 'teable-session=test' },
        (error, data) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(data as Record<string, { v: number; type: string | null; data?: unknown }>);
        }
      );
    });

    expect(snapshots.recExisting.v).toBe(2);
    expect(snapshots.recDeleted).toMatchObject({
      v: 0,
      type: null,
      data: undefined,
    });
  });

  // it('create simple document', (done) => {
  //   const randomTitle = `B:${Math.floor(Math.random() * 1000)}`;
  //   const doc = provider.connect().get('books', randomTitle);
  //   doc.create({ title: randomTitle }, function (error) {
  //     if (error) throw error;
  //     doc.submitOp({ p: ['author'], oi: 'George Orwell' }, undefined, (error: unknown) => {
  //       if (error) throw error;
  //       console.log('submit succeed!');
  //       done();
  //     });
  //   });
  // }, 1000);
});

describe('ShareDB internal field snapshot admission', () => {
  const fetchField = async (remote: boolean, userId?: string) => {
    const storedRead = vi
      .fn()
      .mockResolvedValue([
        {
          id: 'fldInternal',
          name: 'Internal',
          type: 'singleLineText',
          version: 7,
          options: '{}',
          meta: '{"secret":true}',
        },
      ]);
    const nativeRead = vi
      .fn()
      .mockResolvedValue([
        { id: 'fldInternal', v: 8, type: 'json0', data: { id: 'fldInternal', name: 'Authorized' } },
      ]);
    const cls = { get: (key: string) => (key === 'user.id' ? userId : undefined) };
    const adapter = new ShareDbAdapter(
      cls as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      { txClient: () => ({ field: { findMany: storedRead } }) } as never,
      { get: () => ({ getSnapshotBulk: nativeRead }) } as never
    );
    const backend = new ShareDB({ db: adapter });
    authMiddleware(backend);
    const connection = remote
      ? backend.connect(undefined, { headers: {}, url: '/socket' })
      : backend.connect();
    try {
      await vi.waitFor(() => expect(connection.state).toBe('connected'));
      const doc = connection.get('fld_tblInternal', 'fldInternal');
      const fetched = Promise.withResolvers<unknown>();
      doc.fetch((error) => fetched.resolve(error));
      const error = await fetched.promise;
      return { error, data: doc.data, version: doc.version, storedRead, nativeRead };
    } finally {
      connection.close();
      const closed = Promise.withResolvers<void>();
      backend.close(() => closed.resolve());
      await closed.promise;
    }
  };

  it('serves bounded actorless metadata only over the trusted in-process transport', async () => {
    const result = await fetchField(false);
    expect(result.error).toBeFalsy();
    expect(result.version).toBe(7);
    expect(result.data).toMatchObject({ id: 'fldInternal', name: 'Internal' });
    expect(result.data).not.toHaveProperty('meta');
    expect(result.storedRead).toHaveBeenCalledWith({
      where: { tableId: 'tblInternal', id: { in: ['fldInternal'] } },
    });
    expect(result.nativeRead).not.toHaveBeenCalled();
  });

  it('uses the existing CLS actor for trusted internal reads', async () => {
    const result = await fetchField(false, 'usrActual');
    expect(result.error).toBeFalsy();
    expect(result.data).toMatchObject({ name: 'Authorized' });
    expect(result.nativeRead).toHaveBeenCalledWith('tblInternal', ['fldInternal']);
    expect(result.storedRead).not.toHaveBeenCalled();
  });

  it('denies a remote connection with no session or share credentials', async () => {
    const result = await fetchField(true);
    expect(result.error).toBeTruthy();
    expect(result.nativeRead).not.toHaveBeenCalled();
    expect(result.storedRead).not.toHaveBeenCalled();
  });
});

describe('ShareDB ops catch-up authorization', () => {
  const setup = (overrides: { probe?: () => Promise<unknown>; sharedTableId?: string } = {}) => {
    const probe = vi.fn(overrides.probe ?? (() => Promise.resolve({ ids: [] })));
    const versionMap = vi.fn().mockResolvedValue({});
    const version = vi.fn().mockResolvedValue({ version: -1, type: RawOpType.Del });
    const readonly = {
      getDocIdsByQuery: probe,
      getVersionAndTypeMap: versionMap,
      getVersionAndType: version,
    };
    const findSharedView = vi
      .fn()
      .mockResolvedValue(overrides.sharedTableId ? { tableId: overrides.sharedTableId } : null);
    const adapter = new ShareDbAdapter(
      { get: () => ({}), runWith: (_store: unknown, fn: () => unknown) => fn() } as never,
      readonly as never,
      readonly as never,
      readonly as never,
      readonly as never,
      {} as never,
      undefined,
      { txClient: () => ({ view: { findFirst: findSharedView } }) } as never
    );
    const bulk = (collection: string, options: unknown) => {
      const done = Promise.withResolvers<unknown>();
      adapter.getOpsBulk(collection, { docProbe: 0 }, undefined, options as never, (error) =>
        done.resolve(error)
      );
      return done.promise;
    };
    const single = (collection: string, options: unknown) => {
      const done = Promise.withResolvers<unknown>();
      adapter.getOps(collection, 'docProbe', 0, null, options as never, (error) =>
        done.resolve(error)
      );
      return done.promise;
    };
    return { bulk, single, probe, versionMap, version, findSharedView };
  };

  const withCookie = () => ({ agentCustom: { cookie: 'session=whatever' } });

  it('refuses a connection that carries no credential, before any read', async () => {
    const { bulk, probe, versionMap } = setup();

    expect(await bulk('fld_tblOther', { agentCustom: {} })).toBeTruthy();
    expect(probe).not.toHaveBeenCalled();
    expect(versionMap).not.toHaveBeenCalled();
  });

  it('refuses a credential the authorized route does not accept, before any read', async () => {
    const { bulk, probe, versionMap } = setup({
      probe: () => Promise.reject(new Error('403')),
    });

    expect(await bulk('fld_tblOther', withCookie())).toBeTruthy();
    expect(probe).toHaveBeenCalledWith('tblOther', {});
    expect(versionMap).not.toHaveBeenCalled();
  });

  it('applies the same check to a single-document catch-up', async () => {
    const { single, version } = setup({ probe: () => Promise.reject(new Error('403')) });

    expect(await single('rec_tblOther', withCookie())).toBeTruthy();
    expect(version).not.toHaveBeenCalled();
  });

  it('applies it to table documents too', async () => {
    const { bulk, probe, versionMap } = setup({
      probe: () => Promise.reject(new Error('403')),
    });

    expect(await bulk('tbl_bseOther', withCookie())).toBeTruthy();
    expect(probe).toHaveBeenCalledWith('bseOther', {});
    expect(versionMap).not.toHaveBeenCalled();
  });

  it('serves a connection the authorized route accepts, asking once per collection', async () => {
    const { bulk, single, probe, versionMap, version } = setup();
    const options = withCookie();

    expect(await bulk('rec_tblOwn', options)).toBeFalsy();
    expect(await single('rec_tblOwn', options)).toBeFalsy();

    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith('tblOwn', { take: 1 });
    expect(versionMap).toHaveBeenCalledWith('tblOwn', ['docProbe']);
    expect(version).toHaveBeenCalledWith('tblOwn', 'docProbe');
  });

  it('asks again after a refusal', async () => {
    let accept = false;
    const { bulk, probe } = setup({
      probe: () => (accept ? Promise.resolve({ ids: [] }) : Promise.reject(new Error('503'))),
    });
    const options = withCookie();

    expect(await bulk('rec_tblOwn', options)).toBeTruthy();
    accept = true;
    expect(await bulk('rec_tblOwn', options)).toBeFalsy();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('keeps a view share to the table it shares', async () => {
    const { bulk, probe, versionMap, findSharedView } = setup({ sharedTableId: 'tblShared' });
    const options = { agentCustom: { shareId: 'shrView' } };

    expect(await bulk('rec_tblOther', options)).toBeTruthy();
    expect(findSharedView).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shareId: 'shrView', enableShare: true, deletedTime: null },
      })
    );
    expect(probe).not.toHaveBeenCalled();
    expect(versionMap).not.toHaveBeenCalled();

    expect(await bulk('rec_tblShared', options)).toBeFalsy();
    expect(probe).toHaveBeenCalledWith('tblShared', { take: 1 });
  });

  it('does not ask for the trusted in-process transport', async () => {
    const { bulk, probe, versionMap } = setup();

    expect(
      await bulk('fld_tblAny', { agentCustom: { [INTERNAL_SHAREDB_CONNECTION]: true } })
    ).toBeFalsy();
    expect(probe).not.toHaveBeenCalled();
    expect(versionMap).toHaveBeenCalled();
  });

  it('leaves the submit pipeline, which reads ops without a connection, as it was', async () => {
    const { single, probe, version } = setup();

    expect(await single('rec_tblAny', { metadata: true })).toBeFalsy();
    expect(probe).not.toHaveBeenCalled();
    expect(version).toHaveBeenCalled();
  });
});

describe('ShareDB historic snapshot fetches', () => {
  const fetchAt = async (remote: boolean) => {
    const version = vi.fn().mockResolvedValue({ version: -1, type: RawOpType.Del });
    const readonly = { getVersionAndType: version };
    const adapter = new ShareDbAdapter(
      { get: () => undefined } as never,
      readonly as never,
      readonly as never,
      readonly as never,
      readonly as never,
      {} as never
    );
    const backend = new ShareDB({ db: adapter });
    authMiddleware(backend);
    const connection = remote
      ? backend.connect(undefined, { headers: { cookie: 'session=whatever' }, url: '/socket' })
      : backend.connect();
    try {
      await vi.waitFor(() => expect(connection.state).toBe('connected'));
      const fetched = Promise.withResolvers<unknown>();
      connection.fetchSnapshot('tbl_bseOther', 'tblOther', 1, (error) => fetched.resolve(error));
      return { error: await fetched.promise, version };
    } finally {
      connection.close();
      const closed = Promise.withResolvers<void>();
      backend.close(() => closed.resolve());
      await closed.promise;
    }
  };

  it('refuses a snapshot at a version to a client connection before any read', async () => {
    const { error, version } = await fetchAt(true);

    expect(String((error as Error).message)).toContain('are not served');
    expect(version).not.toHaveBeenCalled();
  });

  it('still lets the trusted in-process transport through to the adapter', async () => {
    const { error, version } = await fetchAt(false);

    // The stub holds no document, so the library answers for itself; what matters is
    // that the request was not refused at the door.
    expect(String((error as Error | undefined)?.message)).not.toContain('are not served');
    expect(version).toHaveBeenCalled();
  });
});
