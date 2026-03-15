import { ResourceType } from '@teable/openapi';
import { ActorId, BaseId, TableId, TableName, TableTrashed } from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@teable/db-main-prisma', () => ({
  PrismaModule: class PrismaModule {},
  PrismaService: class PrismaService {},
}));

import { V2TableTrashedProjection } from './v2-table-trash.service';

describe('V2TableTrashedProjection', () => {
  it('writes a table trash entry for soft-deleted tables', async () => {
    const deletedTime = new Date('2026-03-12T00:00:00.000Z');
    const prisma = {
      tableMeta: {
        findUnique: vi.fn().mockResolvedValue({
          baseId: 'bseaaaaaaaaaaaaaaaa',
          deletedTime,
        }),
      },
      trash: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({}),
      },
    };

    const projection = new V2TableTrashedProjection(prisma as never);
    const context = {
      actorId: ActorId.create('usrTestUserId')._unsafeUnwrap(),
    };
    const event = TableTrashed.create({
      tableId: TableId.create('tblaaaaaaaaaaaaaaaa')._unsafeUnwrap(),
      baseId: BaseId.create('bseaaaaaaaaaaaaaaaa')._unsafeUnwrap(),
      tableName: TableName.create('Trash Me')._unsafeUnwrap(),
      fieldIds: [],
      viewIds: [],
    });

    const result = await projection.handle(context, event);

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(prisma.tableMeta.findUnique).toHaveBeenCalledWith({
      where: { id: 'tblaaaaaaaaaaaaaaaa' },
      select: { baseId: true, deletedTime: true },
    });
    expect(prisma.trash.deleteMany).toHaveBeenCalledWith({
      where: {
        resourceId: 'tblaaaaaaaaaaaaaaaa',
        resourceType: ResourceType.Table,
      },
    });
    expect(prisma.trash.create).toHaveBeenCalledWith({
      data: {
        resourceId: 'tblaaaaaaaaaaaaaaaa',
        resourceType: ResourceType.Table,
        parentId: 'bseaaaaaaaaaaaaaaaa',
        deletedTime,
        deletedBy: 'usrTestUserId',
      },
    });
  });
});
