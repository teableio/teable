import {
  BaseId,
  TableCreated,
  TableDeleted,
  TableId,
  TableName,
  TableRestored,
  TableTrashed,
} from '@teable/v2-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateBaseNodeListCacheKey } from '../../performance-cache/generate-keys';
import { V2TableBaseNodeProjection } from './v2-base-node-compat.service';

vi.mock('../../performance-cache', () => ({
  PerformanceCacheService: class PerformanceCacheService {},
}));

vi.mock('../../share-db/share-db.service', () => ({
  ShareDbService: class ShareDbService {},
}));

const createLocalPresence = () => ({
  submit: vi.fn(),
  destroy: vi.fn(),
});

describe('V2TableBaseNodeProjection', () => {
  const baseId = 'bseaaaaaaaaaaaaaaaa';
  const tableId = 'tblaaaaaaaaaaaaaaaa';

  const createEvent = (
    factory: typeof TableCreated | typeof TableTrashed | typeof TableDeleted | typeof TableRestored
  ) =>
    factory.create({
      tableId: TableId.create(tableId)._unsafeUnwrap(),
      baseId: BaseId.create(baseId)._unsafeUnwrap(),
      tableName: TableName.create('Test Table')._unsafeUnwrap(),
      fieldIds: [],
      viewIds: [],
    });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['create', () => createEvent(TableCreated)],
    ['trash', () => createEvent(TableTrashed)],
    ['delete', () => createEvent(TableDeleted)],
    ['restore', () => createEvent(TableRestored)],
  ])('invalidates base-node cache and flushes presence on %s', async (_name, buildEvent) => {
    const localPresence = createLocalPresence();
    const performanceCacheService = {
      del: vi.fn(),
    };
    const shareDbService = {
      shareDbAdapter: { closed: false },
      connect: vi.fn().mockReturnValue({
        getPresence: vi.fn().mockReturnValue({
          create: vi.fn().mockReturnValue(localPresence),
        }),
      }),
    };

    const projection = new V2TableBaseNodeProjection(
      performanceCacheService as never,
      shareDbService as never
    );

    const result = await projection.handle({} as never, buildEvent());

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(performanceCacheService.del).toHaveBeenCalledWith(generateBaseNodeListCacheKey(baseId));
    expect(shareDbService.connect).toHaveBeenCalled();
    expect(localPresence.submit).toHaveBeenCalledWith({ event: 'flush' });
    expect(localPresence.destroy).toHaveBeenCalled();
  });

  it('only invalidates cache when sharedb is closed', async () => {
    const performanceCacheService = {
      del: vi.fn(),
    };
    const shareDbService = {
      shareDbAdapter: { closed: true },
      connect: vi.fn(),
    };

    const projection = new V2TableBaseNodeProjection(
      performanceCacheService as never,
      shareDbService as never
    );

    const result = await projection.handle({} as never, createEvent(TableTrashed));

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(performanceCacheService.del).toHaveBeenCalledWith(generateBaseNodeListCacheKey(baseId));
    expect(shareDbService.connect).not.toHaveBeenCalled();
  });
});
