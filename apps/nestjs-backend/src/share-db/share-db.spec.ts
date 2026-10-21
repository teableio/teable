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
