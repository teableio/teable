/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldType, generateBaseNodeFolderId, Relationship, ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IBaseNodeVo, ITrashItemVo } from '@teable/openapi';
import {
  axios,
  BaseNodeResourceType,
  createBase,
  createBaseNode,
  createBaseShare,
  deleteBaseNode,
  DELETE_BASE_NODE_STREAM,
  deleteBaseNodeFolder,
  deleteDashboard,
  DELETE_TRASH,
  deleteTrash,
  getBaseNodeTree,
  getTrashItems,
  moveBaseNode,
  permanentDeleteBaseNode,
  resetTrashItems,
  restoreTrash,
  spaceSearch,
  TrashType,
  updateBaseNodeFolder,
  urlBuilder,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { vi } from 'vitest';
import { DistributedLockService } from '../src/distributed-lock/distributed-lock.service';
import { BaseNodeService } from '../src/features/base-node/base-node.service';
import { projectNodeLockName } from '../src/features/base-node/project-node-lock';
import { TrashService } from '../src/features/trash/trash.service';
import type { IClsStore } from '../src/types/cls';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { createField, initApp, permanentDeleteBase } from './utils/init-app';

describe('Folder delete to trash (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseId: string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    prisma = app.get(PrismaService);
    baseId = (await createBase({ name: 'folder trash', spaceId: globalThis.testConfig.spaceId }))
      .data.id;
  });

  afterAll(async () => {
    await permanentDeleteBase(baseId);
    await app.close();
  });

  const createFolder = async (name: string, parentId?: string) =>
    (await createBaseNode(baseId, { resourceType: BaseNodeResourceType.Folder, name, parentId }))
      .data;

  const createTable = async (name: string, parentId?: string) =>
    (
      await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name,
        parentId,
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      })
    ).data;

  const createDashboard = async (name: string, parentId?: string) =>
    (await createBaseNode(baseId, { resourceType: BaseNodeResourceType.Dashboard, name, parentId }))
      .data;

  const nodes = async () => (await getBaseNodeTree(baseId)).data.nodes;
  const nodeOf = (list: IBaseNodeVo[], resourceId: string) =>
    list.find((node) => node.resourceId === resourceId);
  const baseTrash = async () =>
    (await getTrashItems({ resourceType: TrashType.Base, resourceId: baseId })).data
      .trashItems as ITrashItemVo[];
  const folderTrash = async (folderId: string) =>
    (await getTrashItems({ resourceType: TrashType.Folder, resourceId: folderId })).data
      .trashItems as ITrashItemVo[];
  const i18nKeyOf = (error: unknown) =>
    (error as { data?: { localization?: { i18nKey?: string } } } | undefined)?.data?.localization
      ?.i18nKey;
  const trashEntry = async <T extends { id: string; resourceId: string }>(
    items: T[],
    resourceId: string
  ) => items.find((item) => item.resourceId === resourceId)!;

  it('moves a folder and everything in it to the trash as one entry, and restores its structure', async () => {
    const folder = await createFolder('Marketing');
    const sub = await createFolder('Q4', folder.id);
    const leads = await createTable('Leads', folder.id);
    const events = await createTable('Events', sub.id);
    const board = await createDashboard('Pipeline', sub.id);

    await deleteBaseNode(baseId, folder.id);

    const afterDelete = await nodes();
    for (const node of [folder, sub, leads, events, board]) {
      expect(nodeOf(afterDelete, node.resourceId)).toBeUndefined();
    }
    const top = await baseTrash();
    expect(
      top.filter((item) => item.resourceType === TrashType.Folder).map((i) => i.resourceId)
    ).toEqual([folder.resourceId]);
    expect(top.some((item) => item.resourceId === leads.resourceId)).toBe(false);
    expect((await folderTrash(folder.resourceId)).map((item) => item.resourceId).sort()).toEqual(
      [leads.resourceId, sub.resourceId].sort()
    );
    expect((await folderTrash(sub.resourceId)).map((item) => item.resourceId).sort()).toEqual(
      [events.resourceId, board.resourceId].sort()
    );
    expect(
      (await prisma.dashboard.findUniqueOrThrow({ where: { id: board.resourceId } })).deletedTime
    ).not.toBeNull();
    const folderRows = await prisma.baseNodeFolder.findMany({
      where: { id: { in: [folder.resourceId, sub.resourceId] } },
      select: { deletedTime: true },
    });
    expect(folderRows.every((row) => row.deletedTime)).toBe(true);

    const { data: restoredItems } = await restoreTrash(
      (await trashEntry(top, folder.resourceId)).id
    );
    expect(restoredItems && restoredItems.restored.map((item) => item.resourceId).sort()).toEqual(
      [folder, sub, leads, events, board].map((node) => node.resourceId).sort()
    );

    const restored = await nodes();
    const restoredFolder = nodeOf(restored, folder.resourceId)!;
    const restoredSub = nodeOf(restored, sub.resourceId)!;
    expect(restoredFolder.parentId).toBeNull();
    expect(nodeOf(restored, leads.resourceId)?.parentId).toBe(restoredFolder.id);
    expect(restoredSub.parentId).toBe(restoredFolder.id);
    expect(nodeOf(restored, events.resourceId)?.parentId).toBe(restoredSub.id);
    expect(nodeOf(restored, board.resourceId)?.parentId).toBe(restoredSub.id);
    expect(
      (await prisma.dashboard.findUniqueOrThrow({ where: { id: board.resourceId } })).deletedTime
    ).toBeNull();
    expect((await baseTrash()).some((item) => item.resourceId === folder.resourceId)).toBe(false);

    await deleteBaseNode(baseId, restoredFolder.id);
  });

  it('moves a dashboard to the trash, and restores it', async () => {
    const board = await createDashboard('Weekly');
    const found = async () =>
      (
        await spaceSearch(globalThis.testConfig.spaceId, { search: 'Weekly', pageSize: 50 })
      ).data.list.some((item) => item.id === board.resourceId);

    await deleteBaseNode(baseId, board.id);

    expect(nodeOf(await nodes(), board.resourceId)).toBeUndefined();
    expect(await found()).toBe(false);
    const entry = await trashEntry(await baseTrash(), board.resourceId);
    expect(entry.resourceType).toBe(TrashType.Dashboard);

    await restoreTrash(entry.id);

    expect(nodeOf(await nodes(), board.resourceId)?.parentId).toBeNull();
    expect(await found()).toBe(true);
    expect(
      (await prisma.dashboard.findUniqueOrThrow({ where: { id: board.resourceId } })).deletedTime
    ).toBeNull();
    await deleteBaseNode(baseId, nodeOf(await nodes(), board.resourceId)!.id);
    await deleteTrash((await trashEntry(await baseTrash(), board.resourceId)).id);
    expect(await prisma.dashboard.findUnique({ where: { id: board.resourceId } })).toBeNull();
  });

  it('restores an item on its own to the root; the folder then brings back what is left', async () => {
    const folder = await createFolder('Sales');
    const kept = await createTable('Contracts', folder.id);
    const early = await createTable('Leads early', folder.id);

    await deleteBaseNode(baseId, folder.id);
    await restoreTrash(
      (await trashEntry(await folderTrash(folder.resourceId), early.resourceId)).id
    );

    const afterItem = await nodes();
    expect(nodeOf(afterItem, early.resourceId)?.parentId).toBeNull();
    expect(nodeOf(afterItem, folder.resourceId)).toBeUndefined();
    expect((await folderTrash(folder.resourceId)).map((item) => item.resourceId)).toEqual([
      kept.resourceId,
    ]);

    await restoreTrash((await trashEntry(await baseTrash(), folder.resourceId)).id);

    const afterFolder = await nodes();
    const restoredFolder = nodeOf(afterFolder, folder.resourceId)!;
    expect(nodeOf(afterFolder, kept.resourceId)?.parentId).toBe(restoredFolder.id);
    expect(nodeOf(afterFolder, early.resourceId)?.parentId).toBeNull();

    await deleteBaseNode(baseId, restoredFolder.id);
    await permanentDeleteBaseNode(baseId, nodeOf(afterFolder, early.resourceId)!.id);
  });

  it('moves an empty folder to the trash too', async () => {
    const folder = await createFolder('Empty');

    await deleteBaseNode(baseId, folder.id);

    expect(nodeOf(await nodes(), folder.resourceId)).toBeUndefined();
    const entry = await trashEntry(await baseTrash(), folder.resourceId);
    expect(entry).toBeDefined();
    await restoreTrash(entry.id);
    const restored = nodeOf(await nodes(), folder.resourceId)!;
    expect(restored.parentId).toBeNull();

    await permanentDeleteBaseNode(baseId, restored.id);
  });

  it('lets a folder in the trash hold no name; restored where the name is taken, it is renamed', async () => {
    const trashed = await createFolder('Reports');
    await deleteBaseNode(baseId, trashed.id);

    const reused = await createFolder('Reports');
    expect(
      (await prisma.baseNodeFolder.findUniqueOrThrow({ where: { id: reused.resourceId } })).name
    ).toBe('Reports');
    const other = await createFolder('Other reports');
    await deleteBaseNode(baseId, reused.id);
    await updateBaseNodeFolder(baseId, other.resourceId, { name: 'Reports' });

    await restoreTrash((await trashEntry(await baseTrash(), trashed.resourceId)).id);

    expect(
      (await prisma.baseNodeFolder.findUniqueOrThrow({ where: { id: trashed.resourceId } })).name
    ).toBe('Reports 2');
    expect(
      (await prisma.baseNodeFolder.findUniqueOrThrow({ where: { id: other.resourceId } })).name
    ).toBe('Reports');
    await deleteBaseNode(baseId, nodeOf(await nodes(), trashed.resourceId)!.id);
    await deleteBaseNode(baseId, other.id);
  });

  it('refuses to permanently delete a folder with anything in it, deleting nothing', async () => {
    const folder = await createFolder('Kept');
    const table = await createTable('Kept table', folder.id);

    const error = await getError(() => permanentDeleteBaseNode(baseId, folder.id));

    expect(error?.status).toBe(400);
    expect(nodeOf(await nodes(), table.resourceId)?.parentId).toBe(folder.id);
    expect(
      (await prisma.tableMeta.findUniqueOrThrow({ where: { id: table.resourceId } })).deletedTime
    ).toBeNull();
    await deleteBaseNode(baseId, folder.id);
  });

  it('restores a folder with its items in the order they had', async () => {
    const folder = await createFolder('Ordered');
    const first = await createTable('First', folder.id);
    const sub = await createFolder('Between', folder.id);
    const last = await createTable('Last', folder.id);
    await deleteBaseNode(baseId, folder.id);

    await restoreTrash((await trashEntry(await baseTrash(), folder.resourceId)).id);

    const restored = await nodes();
    const folderNode = nodeOf(restored, folder.resourceId)!;
    expect(
      restored
        .filter((node) => node.parentId === folderNode.id)
        .sort((a, b) => a.order - b.order)
        .map((node) => node.resourceId)
    ).toEqual([first.resourceId, sub.resourceId, last.resourceId]);
    await deleteBaseNode(baseId, folderNode.id);
  });

  it('drops a stale trash row and keeps the table it names, which is in use', async () => {
    const table = await createTable('In use');
    const row = await prisma.trash.create({
      data: {
        resourceType: TrashType.Table,
        resourceId: table.resourceId,
        parentId: baseId,
        deletedBy: globalThis.testConfig.userId,
      },
    });
    // Nothing to show for it: the trash lists only what is deleted.
    expect((await baseTrash()).some((item) => item.id === row.id)).toBe(false);

    await deleteTrash(row.id);

    expect(await prisma.trash.findUnique({ where: { id: row.id } })).toBeNull();
    expect(
      (await prisma.tableMeta.findUniqueOrThrow({ where: { id: table.resourceId } })).deletedTime
    ).toBeNull();
    expect(nodeOf(await nodes(), table.resourceId)).toBeDefined();
    await permanentDeleteBaseNode(baseId, table.id);
  });

  it('holds the project lock through a move, so a folder delete waits for none', async () => {
    const folder = await createFolder('Deleted during a move');
    const table = await createTable('Moved out', folder.id);
    // On the prototype: the edition's BaseNodeService, the one the routes use, extends this one.
    const proto = BaseNodeService.prototype as unknown as {
      moveInProject: (...args: unknown[]) => Promise<unknown>;
    };
    const moveInProject = proto.moveInProject;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let moving!: () => void;
    const started = new Promise<void>((resolve) => (moving = resolve));
    const spy = vi.spyOn(proto, 'moveInProject').mockImplementation(async function (
      this: unknown,
      ...args: unknown[]
    ) {
      moving();
      await held;
      return moveInProject.apply(this, args);
    });

    const move = moveBaseNode(baseId, table.id, { parentId: null });
    await started;
    const error = await getError(() => deleteBaseNode(baseId, folder.id)).finally(release);
    await move;
    spy.mockRestore();

    expect(error?.status).toBe(409);
    expect(i18nKeyOf(error)).toBe('httpErrors.baseNode.projectBusy');
    expect(nodeOf(await nodes(), table.resourceId)?.parentId).toBeNull();
    await deleteBaseNode(baseId, folder.id);
    await permanentDeleteBaseNode(baseId, table.id);
  });

  it('restores nothing for an entry gone since the request read it', async () => {
    const folder = await createFolder('Restored and deleted again');
    const table = await createTable('Deleted twice', folder.id);
    await deleteBaseNode(baseId, folder.id);
    const first = await trashEntry(await folderTrash(folder.resourceId), table.resourceId);
    await restoreTrash((await trashEntry(await baseTrash(), folder.resourceId)).id);
    // The restore gave the table a new node.
    await deleteBaseNode(baseId, nodeOf(await nodes(), table.resourceId)!.id);
    const service = app.get(TrashService);
    // The decision as the request made it, from the first entry, before the lock.
    const spy = vi.spyOn(service, 'getRestoreTableV2Decision').mockResolvedValue({
      useV2: true,
      reason: 'env_force_v2_all',
      baseId,
      tableId: table.resourceId,
    });

    const error = await app
      .get<ClsService<IClsStore>>(ClsService)
      .runWith({ user: { id: globalThis.testConfig.userId } } as unknown as IClsStore, () =>
        service.restoreTrashV2(first.id)
      )
      .catch((e: { status?: number }) => e);
    spy.mockRestore();

    expect((error as { status?: number }).status).toBe(404);
    expect(
      (await prisma.tableMeta.findUniqueOrThrow({ where: { id: table.resourceId } })).deletedTime
    ).not.toBeNull();
    await deleteBaseNode(baseId, nodeOf(await nodes(), folder.resourceId)!.id);
  });

  it('says how much of a folder is back when its restore stops part way', async () => {
    const folder = await createFolder('Restored in part');
    const tables = [
      await createTable('Part one', folder.id),
      await createTable('Part two', folder.id),
    ];
    await deleteBaseNode(baseId, folder.id);
    const entry = await trashEntry(await baseTrash(), folder.resourceId);
    // On the prototype: the edition's TrashService, the one the routes use, extends this one.
    const proto = TrashService.prototype as unknown as {
      getRestoreTableV2Decision: (...args: unknown[]) => Promise<unknown>;
      restoreFolderItem: (...args: unknown[]) => Promise<unknown>;
    };
    const decision = vi.spyOn(proto, 'getRestoreTableV2Decision').mockResolvedValue({
      useV2: true,
      reason: 'env_force_v2_all',
      baseId,
      tableId: folder.resourceId,
    });
    const restoreFolderItem = proto.restoreFolderItem;
    let calls = 0;
    const item = vi.spyOn(proto, 'restoreFolderItem').mockImplementation(async function (
      this: unknown,
      ...args: unknown[]
    ) {
      if (++calls > 1) throw new Error('restore failed');
      return restoreFolderItem.apply(this, args);
    });

    const error = await getError(() => restoreTrash(entry.id)).finally(() => {
      decision.mockRestore();
      item.mockRestore();
    });

    expect(error?.status).toBe(500);
    expect(
      (error?.data as { localization?: Record<string, unknown> } | undefined)?.localization
    ).toMatchObject({ i18nKey: 'httpErrors.trash.folderRestorePartial', context: { count: 1 } });
    const rows = await prisma.tableMeta.findMany({
      where: { id: { in: tables.map((table) => table.resourceId) } },
      select: { deletedTime: true },
    });
    expect(rows.filter((row) => row.deletedTime === null)).toHaveLength(1);

    await restoreTrash(entry.id);
    await deleteBaseNode(baseId, nodeOf(await nodes(), folder.resourceId)!.id);
    for (const table of tables) {
      const node = nodeOf(await nodes(), table.resourceId);
      if (node) await deleteBaseNode(baseId, node.id);
    }
  });

  it('refuses to rename a folder in the trash', async () => {
    const folder = await createFolder('Renamed in the trash');
    await deleteBaseNode(baseId, folder.id);

    const error = await getError(() =>
      updateBaseNodeFolder(baseId, folder.resourceId, { name: 'Renamed meanwhile' })
    );

    expect(error?.status).toBe(404);
    expect(
      (await prisma.baseNodeFolder.findUniqueOrThrow({ where: { id: folder.resourceId } })).name
    ).toBe('Renamed in the trash');
  });

  it('moves a folder into a project whose trash holds a folder of that name', async () => {
    const target = (
      await createBase({ name: 'folder trash target', spaceId: globalThis.testConfig.spaceId })
    ).data.id;
    try {
      const trashed = (
        await createBaseNode(target, { resourceType: BaseNodeResourceType.Folder, name: 'Shared' })
      ).data;
      await deleteBaseNode(target, trashed.id);
      const folder = await createFolder('Shared');

      await moveBaseNode(baseId, folder.id, { targetBaseId: target });

      const moved = await prisma.baseNodeFolder.findUniqueOrThrow({
        where: { id: folder.resourceId },
      });
      expect(moved).toMatchObject({ baseId: target, name: 'Shared', deletedTime: null });
    } finally {
      await permanentDeleteBase(target);
    }
  });

  it('drops the trash entries of a trashed folder and its items when the project is purged', async () => {
    const other = (
      await createBase({ name: 'folder trash purge', spaceId: globalThis.testConfig.spaceId })
    ).data.id;
    const folder = (
      await createBaseNode(other, { resourceType: BaseNodeResourceType.Folder, name: 'Gone' })
    ).data;
    const board = (
      await createBaseNode(other, {
        resourceType: BaseNodeResourceType.Dashboard,
        name: 'Gone',
        parentId: folder.id,
      })
    ).data;
    await deleteBaseNode(other, folder.id);

    await permanentDeleteBase(other);

    expect(
      await prisma.trash.findMany({
        where: { resourceId: { in: [folder.resourceId, board.resourceId] } },
      })
    ).toEqual([]);
  });

  it('empties the project trash, dashboards too, dropping stale entries and keeping the tables', async () => {
    const other = (
      await createBase({ name: 'folder trash reset', spaceId: globalThis.testConfig.spaceId })
    ).data.id;
    try {
      const table = (
        await createBaseNode(other, {
          resourceType: BaseNodeResourceType.Table,
          name: 'In use',
          fields: [{ name: 'Name', type: FieldType.SingleLineText }],
          views: [{ name: 'Grid view', type: ViewType.Grid }],
        })
      ).data;
      const row = await prisma.trash.create({
        data: {
          resourceType: TrashType.Table,
          resourceId: table.resourceId,
          parentId: other,
          deletedBy: globalThis.testConfig.userId,
        },
      });

      const boards = [];
      for (const name of ['Gone', 'Gone too']) {
        const board = (
          await createBaseNode(other, { resourceType: BaseNodeResourceType.Dashboard, name })
        ).data;
        await deleteBaseNode(other, board.id);
        boards.push(board);
      }
      // Whether each is still deleted is asked once per resource type, not once per resource.
      const isLive = vi.spyOn(
        app.get(TrashService) as unknown as { isTrashResourceLive: () => Promise<boolean> },
        'isTrashResourceLive'
      );

      await resetTrashItems({ resourceType: TrashType.Base, resourceId: other });
      const perResourceChecks = isLive.mock.calls.length;
      isLive.mockRestore();

      expect(perResourceChecks).toBe(0);
      const boardIds = boards.map((board) => board.resourceId);
      expect(await prisma.dashboard.findMany({ where: { id: { in: boardIds } } })).toEqual([]);
      expect(await prisma.trash.findMany({ where: { resourceId: { in: boardIds } } })).toEqual([]);
      expect(await prisma.trash.findUnique({ where: { id: row.id } })).toBeNull();
      expect(
        (await prisma.tableMeta.findUniqueOrThrow({ where: { id: table.resourceId } })).deletedTime
      ).toBeNull();
    } finally {
      await permanentDeleteBase(other);
    }
  });

  it('refuses a move while a folder delete in the project runs', async () => {
    const folder = await createFolder('Move target');
    const table = await createTable('Not moved');
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => (locked = resolve));
    const lock = app
      .get(DistributedLockService)
      .runExclusive(projectNodeLockName(baseId), 30, async () => {
        locked();
        await held;
      });
    await acquired;

    const error = await getError(() =>
      moveBaseNode(baseId, table.id, { parentId: folder.id })
    ).finally(release);
    await lock;

    expect(error?.status).toBe(409);
    expect(i18nKeyOf(error)).toBe('httpErrors.baseNode.projectBusy');
    expect(nodeOf(await nodes(), table.resourceId)?.parentId).toBeNull();
    await permanentDeleteBaseNode(baseId, table.id);
    await deleteBaseNode(baseId, folder.id);
  });

  it('purging a trashed folder purges what is inside it', async () => {
    const folder = await createFolder('Purged');
    const table = await createTable('Purged table', folder.id);
    const board = await createDashboard('Purged dashboard', folder.id);
    await deleteBaseNode(baseId, folder.id);

    await deleteTrash((await trashEntry(await baseTrash(), folder.resourceId)).id);

    expect(await prisma.baseNodeFolder.findUnique({ where: { id: folder.resourceId } })).toBeNull();
    expect(await prisma.tableMeta.findUnique({ where: { id: table.resourceId } })).toBeNull();
    expect(await prisma.dashboard.findUnique({ where: { id: board.resourceId } })).toBeNull();
    expect(
      await prisma.trash.findMany({
        where: { resourceId: { in: [folder.resourceId, table.resourceId, board.resourceId] } },
      })
    ).toEqual([]);
  });

  it('pages a folder whose items share one deleted time without repeating any', async () => {
    const folder = await createFolder('Many at once');
    const subs = [];
    for (let i = 0; i < 24; i++) subs.push(await createFolder(`Part ${i}`, folder.id));
    await deleteBaseNode(baseId, folder.id);

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const { data } = await getTrashItems({
        resourceType: TrashType.Folder,
        resourceId: folder.resourceId,
        cursor,
        pageSize: 8,
      });
      seen.push(...(data.trashItems as ITrashItemVo[]).map((item) => item.resourceId));
      cursor = data.nextCursor ?? undefined;
    } while (cursor);

    expect(seen.sort()).toEqual(subs.map((sub) => sub.resourceId).sort());
    await deleteTrash((await trashEntry(await baseTrash(), folder.resourceId)).id);
  });

  it('leaves a dashboard already in the trash out of its folder delete, the node not yet dropped', async () => {
    const folder = await createFolder('Holds a deleted board');
    const table = await createTable('Still here', folder.id);
    const board = await createDashboard('Deleted on its own', folder.id);
    // As the dashboard route leaves it until the tree drops the node: deleted, entry at the
    // project, node still under the folder.
    const deletedTime = new Date();
    await prisma.dashboard.update({ where: { id: board.resourceId }, data: { deletedTime } });
    const own = await prisma.trash.create({
      data: {
        resourceType: TrashType.Dashboard,
        resourceId: board.resourceId,
        parentId: baseId,
        deletedTime,
        deletedBy: globalThis.testConfig.userId,
      },
    });

    await deleteBaseNode(baseId, folder.id);

    expect(await prisma.trash.findUnique({ where: { id: own.id } })).toMatchObject({
      parentId: baseId,
    });
    expect((await folderTrash(folder.resourceId)).map((item) => item.resourceId)).toEqual([
      table.resourceId,
    ]);
    expect(await prisma.baseNode.findUnique({ where: { id: board.id } })).toBeNull();
    await deleteTrash(own.id);
    await deleteTrash((await trashEntry(await baseTrash(), folder.resourceId)).id);
  });

  it('takes the shares of a dashboard deleted on its own route as it is restored', async () => {
    const board = await createDashboard('Shared, then deleted');
    await createBaseShare(baseId, { nodeId: board.id });
    // The dashboard route leaves the node, and its share, until the tree drops it.
    await deleteDashboard(baseId, board.resourceId);
    const entry = await trashEntry(await baseTrash(), board.resourceId);

    await restoreTrash(entry.id);

    expect(await prisma.baseShare.findMany({ where: { baseId, nodeId: board.id } })).toEqual([]);
    expect(await prisma.baseNode.findUnique({ where: { id: board.id } })).toBeNull();
    const restored = nodeOf(await nodes(), board.resourceId)!;
    expect(restored.parentId).toBeNull();
    await deleteBaseNode(baseId, restored.id);
    await deleteTrash((await trashEntry(await baseTrash(), board.resourceId)).id);
  });

  it('leaves an entry restorable when its purge is refused', async () => {
    const board = await createDashboard('Purge refused');
    await deleteBaseNode(baseId, board.id);
    const entry = await trashEntry(await baseTrash(), board.resourceId);

    const outsider = await createNewUserAxios({
      email: 'folder-trash-outsider@example.com',
      password: '12345678',
    });
    const refused = await getError(() =>
      outsider.delete(urlBuilder(DELETE_TRASH, { trashId: entry.id }))
    );
    expect(refused?.status).toBe(403);

    await restoreTrash(entry.id);
    expect(
      (await prisma.dashboard.findUniqueOrThrow({ where: { id: board.resourceId } })).deletedTime
    ).toBeNull();
    await permanentDeleteBaseNode(baseId, nodeOf(await nodes(), board.resourceId)!.id);
  });

  it('names the folder in trash rows only once the folder is in the trash', async () => {
    const folder = await createFolder('Rows at the project');
    const first = await createTable('First', folder.id);
    const second = await createTable('Second', folder.id);
    // On the prototype: the edition's BaseNodeService, the one the routes use, extends this one.
    const proto = BaseNodeService.prototype as unknown as {
      deleteResource: (...args: unknown[]) => Promise<unknown>;
    };
    const deleteResource = proto.deleteResource;
    let midway: { resourceId: string; parentId: string | null }[] = [];
    const spy = vi.spyOn(proto, 'deleteResource').mockImplementation(async function (
      this: unknown,
      ...args: unknown[]
    ) {
      if (args[2] === second.resourceId) {
        midway = await prisma.trash.findMany({
          where: { resourceId: { in: [folder.resourceId, first.resourceId] } },
          select: { resourceId: true, parentId: true },
        });
      }
      return deleteResource.apply(this, args);
    });

    await deleteBaseNode(baseId, folder.id);
    spy.mockRestore();

    // Stopped here, the first table would be an ordinary entry of the project.
    expect(midway).toEqual([{ resourceId: first.resourceId, parentId: baseId }]);
    const rows = await prisma.trash.findMany({
      where: { resourceId: { in: [folder.resourceId, first.resourceId] } },
      select: { resourceId: true, parentId: true },
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        { resourceId: folder.resourceId, parentId: baseId },
        { resourceId: first.resourceId, parentId: folder.resourceId },
      ])
    );
  });

  it('streams a folder delete: one progress event per resource, then the deleted folder', async () => {
    const folder = await createFolder('Streamed');
    await createTable('First', folder.id);
    await createTable('Second', folder.id);

    const { data } = await axios.delete<string>(
      urlBuilder(DELETE_BASE_NODE_STREAM, { baseId, nodeId: folder.id }),
      { responseType: 'text' }
    );
    const events = data
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => JSON.parse(line.slice(5)));

    expect(events).toEqual([
      { id: 'progress', done: 1, total: 2 },
      { id: 'progress', done: 2, total: 2 },
      { id: 'done', data: { resourceType: 'folder', resourceId: folder.resourceId } },
    ]);
    expect(await trashEntry(await baseTrash(), folder.resourceId)).toBeDefined();
  });

  it('deletes a folder made before the folder route made its node, by its folder ID', async () => {
    const folder = await prisma.baseNodeFolder.create({
      data: {
        id: generateBaseNodeFolderId(),
        baseId,
        name: 'Made without a node',
        createdBy: globalThis.testConfig.userId,
      },
    });

    await deleteBaseNodeFolder(baseId, folder.id);

    expect(
      (await prisma.baseNodeFolder.findUniqueOrThrow({ where: { id: folder.id } })).deletedTime
    ).not.toBeNull();
    expect(await trashEntry(await baseTrash(), folder.id)).toBeDefined();
  });

  it('lets the caller refuse the delete on the subtree it would delete, leaving it all', async () => {
    const folder = await createFolder('Checked under the lock');
    const table = await createTable('Moved in', folder.id);
    const refused = new Error('not empty');
    const service = app.get(BaseNodeService);

    const error = await app
      .get<ClsService<IClsStore>>(ClsService)
      .runWith({ user: { id: globalThis.testConfig.userId } } as unknown as IClsStore, () =>
        service.delete(baseId, folder.id, true, {
          assertSubtree: (subtree) => {
            if (subtree.length > 1) throw refused;
          },
        })
      )
      .catch((e: unknown) => e);

    expect(error).toBe(refused);
    expect(nodeOf(await nodes(), table.resourceId)?.parentId).toBe(folder.id);
    await deleteBaseNode(baseId, folder.id);
  });

  it('previews a folder delete: every item, and links from tables outside', async () => {
    const folder = await createFolder('Previewed');
    const inside = await createTable('Inside', folder.id);
    const outside = await createTable('Outside');
    await createField(outside.resourceId, {
      name: 'Inside link',
      type: FieldType.Link,
      options: { relationship: Relationship.ManyOne, foreignTableId: inside.resourceId },
    });

    const { data } = await axios.post('/v2/operations/preview', {
      operation: 'folder.delete',
      input: { baseId, nodeId: folder.id },
      options: { detail: 'full' },
    });

    const preview = data.data;
    expect(preview.operation).toBe('folder.delete');
    expect(preview.blockers).toEqual([]);
    const items = preview.effects.filter((effect: { code: string }) =>
      effect.code.startsWith('folder.delete.item.')
    );
    expect(items.map((effect: { code: string }) => effect.code)).toEqual([
      'folder.delete.item.folder',
      'folder.delete.item.table',
    ]);
    expect(items[1].measures.fields).toMatchObject({ basis: 'exact', value: 1 });

    await deleteBaseNode(baseId, folder.id);
    await permanentDeleteBaseNode(baseId, outside.id);
  });

  it('previews the delete of a folder made before the folder route made its node', async () => {
    const folder = await prisma.baseNodeFolder.create({
      data: {
        id: generateBaseNodeFolderId(),
        baseId,
        name: 'Previewed without a node',
        createdBy: globalThis.testConfig.userId,
      },
    });

    const { data } = await axios.post('/v2/operations/preview', {
      operation: 'folder.delete',
      input: { baseId, nodeId: folder.id },
      options: { detail: 'full' },
    });

    expect(data.data.blockers).toEqual([]);
    expect(
      data.data.effects
        .map((effect: { code: string }) => effect.code)
        .filter((code: string) => code.startsWith('folder.delete.item.'))
    ).toEqual(['folder.delete.item.folder']);
    await deleteBaseNodeFolder(baseId, folder.id);
  });
});
