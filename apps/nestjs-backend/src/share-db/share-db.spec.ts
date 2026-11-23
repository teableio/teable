import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { IdPrefix } from '@teable/core';
import ShareDB from 'sharedb';
import { vi } from 'vitest';
import { authMiddleware } from './auth.middleware';
import { GlobalModule } from '../global/global.module';
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
