import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { IdPrefix } from '@teable/core';
import { vi } from 'vitest';
import { GlobalModule } from '../global/global.module';
import { ShareDbAdapter } from './share-db.adapter';
import { ShareDbModule } from './share-db.module';
import { ShareDbService } from './share-db.service';

describe('ShareDb', () => {
  let provider: ShareDbService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, ShareDbModule],
    }).compile();

    provider = module.get<ShareDbService>(ShareDbService);
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

  it('serves versioned compute activity snapshots after field-read authorization', async () => {
    const cls = {
      get: vi.fn(() => undefined),
      runWith: vi.fn((_store, fn) => fn()),
    };
    const fieldService = {
      authorizeComputedActivityDocuments: vi.fn().mockResolvedValue(undefined),
      getSnapshotBulk: vi.fn().mockResolvedValue([]),
    };
    const adapter = new ShareDbAdapter(
      cls as never,
      {} as never,
      {} as never,
      fieldService as never,
      {} as never,
      {} as never
    );
    const loader = vi.fn().mockResolvedValue({
      table: { version: 4, data: { status: 'calculating', generation: 4 } },
      fldFormula: { version: 5, data: { status: 'running', generation: 5 } },
    });
    adapter.setComputedActivitySnapshotLoader(loader);

    const snapshots = await new Promise<
      Record<string, { v: number; type: string | null; data?: unknown }>
    >((resolve, reject) => {
      adapter.getSnapshotBulk(
        'cmp_tblTest',
        ['table', 'fldFormula', 'fldMissing'],
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

    expect(fieldService.authorizeComputedActivityDocuments).toHaveBeenCalledWith('tblTest', [
      'table',
      'fldFormula',
      'fldMissing',
    ]);
    expect(loader).toHaveBeenCalledWith('tblTest');
    expect(snapshots.table).toMatchObject({
      v: 4,
      type: 'json0',
      data: { status: 'calculating', generation: 4 },
    });
    expect(snapshots.fldFormula).toMatchObject({
      v: 5,
      type: 'json0',
      data: { status: 'running', generation: 5 },
    });
    expect(snapshots.fldMissing).toMatchObject({ v: 0, type: null, data: undefined });
  });

  it('reconstructs compute activity operation gaps from the latest snapshot', async () => {
    const cls = {
      get: vi.fn(() => undefined),
      runWith: vi.fn((_store, fn) => fn()),
    };
    const fieldService = {
      authorizeComputedActivityDocuments: vi.fn().mockResolvedValue(undefined),
      getSnapshotBulk: vi.fn().mockResolvedValue([]),
    };
    const adapter = new ShareDbAdapter(
      cls as never,
      {} as never,
      {} as never,
      fieldService as never,
      {} as never,
      {} as never
    );
    adapter.setComputedActivitySnapshotLoader(async () => ({
      fldFormula: { version: 3, data: { status: 'idle', generation: 3 } },
    }));

    const ops = await new Promise<Array<{ v: number; op?: unknown[] }>>((resolve, reject) => {
      adapter.getOps(
        'cmp_tblTest',
        'fldFormula',
        1,
        null,
        { cookie: 'teable-session=test' },
        (error, data) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(data as Array<{ v: number; op?: unknown[] }>);
        }
      );
    });

    expect(ops.map((op) => op.v)).toEqual([1, 2]);
    expect(ops.at(-1)?.op).toEqual([{ p: [], oi: { status: 'idle', generation: 3 } }]);
  });

  it('reconstructs the first compute activity generation as a create operation', async () => {
    const cls = {
      get: vi.fn(() => undefined),
      runWith: vi.fn((_store, fn) => fn()),
    };
    const fieldService = {
      authorizeComputedActivityDocuments: vi.fn().mockResolvedValue(undefined),
      getSnapshotBulk: vi.fn().mockResolvedValue([]),
    };
    const adapter = new ShareDbAdapter(
      cls as never,
      {} as never,
      {} as never,
      fieldService as never,
      {} as never,
      {} as never
    );
    adapter.setComputedActivitySnapshotLoader(async () => ({
      fldFormula: { version: 1, data: { status: 'queued', generation: 1 } },
    }));

    const ops = await new Promise<Array<{ v: number; create?: unknown }>>((resolve, reject) => {
      adapter.getOps(
        'cmp_tblTest',
        'fldFormula',
        0,
        null,
        { cookie: 'teable-session=test' },
        (error, data) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(data as Array<{ v: number; create?: unknown }>);
        }
      );
    });

    expect(ops).toMatchObject([
      {
        v: 0,
        create: { type: 'json0', data: { status: 'queued', generation: 1 } },
      },
    ]);
  });

  it('replays later compute activity generations as creates from version zero', async () => {
    const cls = {
      get: vi.fn(() => undefined),
      runWith: vi.fn((_store, fn) => fn()),
    };
    const fieldService = {
      authorizeComputedActivityDocuments: vi.fn().mockResolvedValue(undefined),
      getSnapshotBulk: vi.fn().mockResolvedValue([]),
    };
    const adapter = new ShareDbAdapter(
      cls as never,
      {} as never,
      {} as never,
      fieldService as never,
      {} as never,
      {} as never
    );
    const data = { status: 'idle', generation: 3 };
    adapter.setComputedActivitySnapshotLoader(async () => ({
      fldFormula: { version: 3, data },
    }));
    type ReplayOp = {
      v: number;
      create?: { type: string; data: unknown };
      op?: unknown[];
    };

    const singleOps = await new Promise<ReplayOp[]>((resolve, reject) => {
      adapter.getOps(
        'cmp_tblTest',
        'fldFormula',
        0,
        null,
        { cookie: 'teable-session=test' },
        (error, result) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(result as ReplayOp[]);
        }
      );
    });
    const bulkOps = await new Promise<Record<string, ReplayOp[]>>((resolve, reject) => {
      adapter.getOpsBulk(
        'cmp_tblTest',
        { fldFormula: 0 },
        undefined,
        { cookie: 'teable-session=test' },
        (error, result) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(result as Record<string, ReplayOp[]>);
        }
      );
    });

    for (const ops of [singleOps, bulkOps.fldFormula]) {
      expect(ops).toHaveLength(3);
      expect(ops[0]).toMatchObject({
        v: 0,
        create: { type: 'json0', data },
      });
      expect(ops.slice(1).map(({ v }) => v)).toEqual([1, 2]);
      expect(ops.slice(1).every((op) => !('create' in op) && !('op' in op))).toBe(true);
    }
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
