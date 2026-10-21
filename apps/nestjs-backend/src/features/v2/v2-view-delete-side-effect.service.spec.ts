import { LastVisitResourceType, PinType } from '@teable/openapi';
import { v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { ActorId, BaseId, TableId, ViewDeleted, ViewId } from '@teable/v2-core';
import { vi } from 'vitest';

import {
  V2ViewDeletedResourceCleanupProjection,
  V2ViewDeleteSideEffectService,
} from './v2-view-delete-side-effect.service';

const createDeleteDb = () => {
  const deletes: Array<{
    table: string;
    where: Array<[string, string, string]>;
    execute: ReturnType<typeof vi.fn>;
  }> = [];
  const db = {
    deleteFrom: vi.fn((table: string) => {
      const query = {
        table,
        where: [] as Array<[string, string, string]>,
        execute: vi.fn().mockResolvedValue(undefined),
      };
      deletes.push(query);
      return {
        where: vi.fn((column: string, operator: string, value: string) => {
          query.where.push([column, operator, value]);
          return {
            where: vi.fn((nextColumn: string, nextOperator: string, nextValue: string) => {
              query.where.push([nextColumn, nextOperator, nextValue]);
              return { execute: query.execute };
            }),
          };
        }),
      };
    }),
  };
  return { db, deletes };
};

const event = ViewDeleted.create({
  baseId: BaseId.create('bse0000000000000001')._unsafeUnwrap(),
  tableId: TableId.create('tbl0000000000000001')._unsafeUnwrap(),
  viewId: ViewId.create('viw0000000000000001')._unsafeUnwrap(),
});

describe('V2ViewDeleteSideEffectService', () => {
  it('registers the cleanup projection with the v2 Kysely connection', () => {
    const { db } = createDeleteDb();
    const container = {
      resolve: vi.fn().mockReturnValue(db),
      registerInstance: vi.fn(),
    };

    new V2ViewDeleteSideEffectService().registerProjections(container as never);

    expect(container.resolve).toHaveBeenCalledWith(v2MetaDbTokens.db);
    expect(container.registerInstance).toHaveBeenCalledWith(
      V2ViewDeletedResourceCleanupProjection,
      expect.any(V2ViewDeletedResourceCleanupProjection)
    );
  });

  it('deletes View last-visit and pin rows without v1 services or EventEmitter', async () => {
    const { db, deletes } = createDeleteDb();
    const projection = new V2ViewDeletedResourceCleanupProjection(db as never);

    const result = await projection.handle(
      { actorId: ActorId.create('system')._unsafeUnwrap() },
      event
    );

    expect(result.isOk()).toBe(true);
    expect(deletes).toEqual([
      expect.objectContaining({
        table: 'user_last_visit',
        where: [
          ['resource_id', '=', 'viw0000000000000001'],
          ['resource_type', '=', LastVisitResourceType.View],
        ],
      }),
      expect.objectContaining({
        table: 'pin_resource',
        where: [
          ['resource_id', '=', 'viw0000000000000001'],
          ['type', '=', PinType.View],
        ],
      }),
    ]);
  });

  it('returns a domain error when Kysely cleanup fails', async () => {
    const { db } = createDeleteDb();
    db.deleteFrom.mockImplementationOnce((_table: string) => ({
      where: (_column: string, _operator: string, _value: string) => ({
        where: (_nextColumn: string, _nextOperator: string, _nextValue: string) => ({
          execute: vi.fn().mockRejectedValue(new Error('cleanup failed')),
        }),
      }),
    }));
    const projection = new V2ViewDeletedResourceCleanupProjection(db as never);

    const result = await projection.handle({} as never, event);

    expect(result._unsafeUnwrapErr().message).toContain('cleanup failed');
  });
});
