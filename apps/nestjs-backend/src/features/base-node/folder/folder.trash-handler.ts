import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Action } from '@teable/core';
import { generateBaseNodeId, getUniqName, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { TrashType } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import { PermissionService } from '../../auth/permission.service';
import {
  ResourceLevel,
  ResourceScopeTarget,
  resourceDescriptorOf,
} from '../../resource/resource-descriptor';
import type {
  ITrashFlow,
  ITrashResourceHandler,
  ITrashResourceItem,
} from '../../trash/resource/trash-resource-handler';
import type { IFolderLifecycleHook } from '../folder-lifecycle.hook';
import { FOLDER_LIFECYCLE_HOOKS } from '../folder-lifecycle.hook';

type IFolderTrashRow = { id: string; resourceType: string; resourceId: string; parentId: string };

/**
 * A folder in the trash holds what was in it: its entry restores or purges them along with it,
 * each the way its own entry would, through the trash's flow.
 */
@Injectable()
export class FolderTrashHandler implements ITrashResourceHandler {
  private readonly logger = new Logger(FolderTrashHandler.name);
  readonly type = TrashType.Folder;
  readonly notFoundI18nKey = 'httpErrors.trash.notFound' as const;
  // Its contents write their own rows; the folder's, even an empty one's, is this one.
  readonly auditActions = {
    restore: 'base.folder.restore',
    permanentDelete: 'base.folder.permanent-delete',
  };

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly permissionService: PermissionService,
    @Optional()
    @Inject(FOLDER_LIFECYCLE_HOOKS)
    private readonly folderLifecycleHooks?: IFolderLifecycleHook[]
  ) {}

  async listTrashed(baseId: string) {
    return this.prismaService.baseNodeFolder.findMany({
      where: { baseId, deletedTime: { not: null } },
      select: { id: true, name: true },
    });
  }

  async findLiveIds(resourceIds: string[]) {
    const rows = await this.prismaService.txClient().baseNodeFolder.findMany({
      where: { id: { in: resourceIds }, deletedTime: null },
      select: { id: true },
    });
    return new Set(rows.map(({ id }) => id));
  }

  async describe(item: ITrashResourceItem) {
    const folder = await this.prismaService.baseNodeFolder.findUnique({
      where: { id: item.resourceId },
      select: { name: true, baseId: true },
    });
    return { baseId: folder?.baseId, name: folder?.name };
  }

  async findBaseId(resourceId: string) {
    const folder = await this.prismaService.txClient().baseNodeFolder.findUnique({
      where: { id: resourceId },
      select: { baseId: true },
    });
    return folder?.baseId ?? null;
  }

  /**
   * Restores a folder with whatever of it is still in the trash, to the end of the project's
   * root, the structure inside kept. Contents restored or purged on their own are not here.
   */
  async restore(baseId: string, folderId: string, flow: ITrashFlow) {
    const prisma = this.prismaService.txClient();
    const allRows = await this.collectTrashRows(folderId);
    // Rows of resources already in use are stale: they go, the resource stays where it is.
    const rows = await this.filterRestorable(allRows, flow);
    await this.assertRestorePermitted(baseId, rows);
    // A v2 table is restored on its own connection, outside this transaction. If anything after
    // it fails, it is not deleted again (that would not undo all its restore did): it stays
    // restored, at the root, and restoring the folder again brings back the rest.
    let restoredOnTheirOwn = 0;
    try {
      for (const row of rows) {
        if (row.resourceType === TrashType.Folder) continue;
        const item = { resourceType: row.resourceType, resourceId: row.resourceId };
        if (await flow.restoreItem(item)) restoredOnTheirOwn++;
      }
      const nodeIdByFolderId = await this.rebuildNodes(baseId, folderId, rows);
      await prisma.trash.deleteMany({ where: { id: { in: allRows.map(({ id }) => id) } } });
      for (const hook of this.folderLifecycleHooks ?? []) {
        await hook.onFoldersRestored(baseId, nodeIdByFolderId);
      }
    } catch (error) {
      if (!restoredOnTheirOwn) throw error;
      this.logger.error(
        `Folder restore in project ${baseId} stopped after ${restoredOnTheirOwn} tables`,
        error instanceof Error ? error.stack : error
      );
      throw new CustomHttpException(
        `The folder was only partly restored: ${restoredOnTheirOwn} of its tables are back at the project root. Restore the folder again to finish.`,
        HttpErrorCode.INTERNAL_SERVER_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.trash.folderRestorePartial',
            context: { count: restoredOnTheirOwn },
          },
        }
      );
    }
    return rows;
  }

  /** Purges trashed folders: what they still hold, then the folders themselves. */
  async purge(baseId: string, folderIds: string[], flow: ITrashFlow) {
    for (const folderId of folderIds) {
      await this.purgeOne(baseId, folderId, flow);
    }
  }

  /** The project's trashed folders, once all they held is gone: emptying its trash ends here. */
  async purgeEmptied(baseId: string) {
    await this.purgeFolders(baseId);
  }

  private async purgeOne(baseId: string, folderId: string, flow: ITrashFlow) {
    if (!(await this.findBaseId(folderId))) {
      await this.prismaService.trash.deleteMany({
        where: { resourceType: TrashType.Folder, resourceId: folderId },
      });
      return;
    }
    const rows = await this.collectTrashRows(folderId);
    if (!flow.ignorePermissionCheck) await this.assertPurgePermitted(baseId, rows);
    for (const row of rows) {
      if (row.resourceType === TrashType.Folder) continue;
      await flow.purgeItem({ ...row, resourceType: row.resourceType as TrashType });
    }
    const folders = rows
      .filter((r) => r.resourceType === TrashType.Folder)
      .map((row) => ({ ...row, resourceType: TrashType.Folder }));
    const described = flow.ignorePermissionCheck
      ? []
      : await Promise.all(folders.map((folder) => flow.describe(folder)));
    await this.purgeFolders(baseId, [folderId, ...folders.map((r) => r.resourceId)]);
    if (flow.ignorePermissionCheck) return;
    for (const [index, folder] of folders.entries()) {
      await flow.auditPermanentDelete(folder, described[index]);
    }
  }

  private async purgeFolders(baseId: string, folderIds?: string[]) {
    await this.prismaService.$tx(async (prisma) => {
      const folders = await prisma.baseNodeFolder.findMany({
        where: {
          baseId,
          deletedTime: { not: null },
          ...(folderIds ? { id: { in: folderIds } } : {}),
        },
        select: { id: true },
      });
      const ids = folders.map(({ id }) => id);
      if (!ids.length) return;
      await prisma.trash.deleteMany({
        where: { resourceType: TrashType.Folder, resourceId: { in: ids } },
      });
      await prisma.baseNodeFolder.deleteMany({ where: { id: { in: ids } } });
    });
  }

  /** Every trash row under a trashed folder, a level at a time, so parents come first. */
  private async collectTrashRows(folderId: string) {
    const rows: IFolderTrashRow[] = [];
    let frontier = [folderId];
    while (frontier.length > 0) {
      const level = await this.prismaService.txClient().trash.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true, resourceType: true, resourceId: true, parentId: true },
        orderBy: { id: 'asc' },
      });
      rows.push(...level.map((row) => ({ ...row, parentId: row.parentId! })));
      frontier = level
        .filter((row) => row.resourceType === TrashType.Folder)
        .map((row) => row.resourceId);
    }
    return rows;
  }

  /** The rows under a trashed folder its restore brings back: those whose resource is deleted. */
  private async filterRestorable(rows: IFolderTrashRow[], flow: ITrashFlow) {
    const restorable: IFolderTrashRow[] = [];
    for (const row of rows) {
      if (!(await flow.isLive(row))) restorable.push(row);
    }
    return restorable.map((row) => ({ ...row, resourceType: row.resourceType as TrashType }));
  }

  /**
   * Gives the restored folders and resources their nodes, nested as they were. A node the
   * tree already made for a restored resource (it puts restored ones at the root) is moved.
   */
  private async rebuildNodes(
    baseId: string,
    rootFolderId: string,
    rows: { resourceType: string; resourceId: string; parentId: string }[]
  ) {
    const prisma = this.prismaService.txClient();
    const folderIds = [
      rootFolderId,
      ...rows.filter((r) => r.resourceType === TrashType.Folder).map((r) => r.resourceId),
    ];
    await this.renameClashing(baseId, folderIds);
    await prisma.baseNodeFolder.updateMany({
      where: { id: { in: folderIds } },
      data: { deletedTime: null },
    });
    const ensureNode = async (
      resourceType: string,
      resourceId: string,
      parentId: string | null,
      order: number
    ) => {
      const existing = await prisma.baseNode.findUnique({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        where: { baseId_resourceType_resourceId: { baseId, resourceType, resourceId } },
        select: { id: true },
      });
      if (existing) {
        await prisma.baseNode.update({ where: { id: existing.id }, data: { parentId, order } });
        return existing.id;
      }
      const id = generateBaseNodeId();
      await prisma.baseNode.create({
        data: {
          id,
          baseId,
          resourceType,
          resourceId,
          parentId,
          order,
          createdBy: this.cls.get('user.id'),
        },
      });
      return id;
    };

    const { _max } = await prisma.baseNode.aggregate({
      where: { baseId, parentId: null },
      _max: { order: true },
    });
    const nodeIdByFolderId = new Map<string, string>();
    nodeIdByFolderId.set(
      rootFolderId,
      await ensureNode(TrashType.Folder, rootFolderId, null, (_max.order ?? 0) + 1)
    );
    const nextOrder = new Map<string, number>();
    for (const row of rows) {
      const parentNodeId = nodeIdByFolderId.get(row.parentId);
      if (!parentNodeId) continue;
      const order = nextOrder.get(parentNodeId) ?? 0;
      nextOrder.set(parentNodeId, order + 1);
      const nodeId = await ensureNode(row.resourceType, row.resourceId, parentNodeId, order);
      if (row.resourceType === TrashType.Folder) nodeIdByFolderId.set(row.resourceId, nodeId);
    }
    return nodeIdByFolderId;
  }

  /**
   * A folder in the trash holds no name: one restored where another folder has taken its name
   * meanwhile gets a new one, as a folder created with that name would.
   */
  private async renameClashing(baseId: string, folderIds: string[]) {
    const prisma = this.prismaService.txClient();
    const [restoring, live] = await Promise.all([
      prisma.baseNodeFolder.findMany({
        where: { id: { in: folderIds } },
        select: { id: true, name: true },
        orderBy: { createdTime: 'asc' },
      }),
      prisma.baseNodeFolder.findMany({
        where: { baseId, deletedTime: null },
        select: { name: true },
      }),
    ]);
    const names = live.map(({ name }) => name);
    for (const folder of restoring) {
      const name = getUniqName(folder.name, names);
      names.push(name);
      if (name === folder.name) continue;
      await prisma.baseNodeFolder.update({ where: { id: folder.id }, data: { name } });
    }
  }

  /**
   * All a folder brings back is checked before the first restore, as each restore checks it: a
   * v2 table restored before a later check failed would stay restored.
   */
  private async assertRestorePermitted(
    baseId: string,
    rows: { resourceType: string; resourceId: string }[]
  ) {
    const accessTokenId = this.cls.get('accessTokenId');
    const scopes = new Set<Action>();
    for (const row of rows) {
      // The folders themselves were checked as the restore began.
      if (row.resourceType === TrashType.Folder) continue;
      const descriptor = resourceDescriptorOf(row.resourceType);
      if (descriptor?.level !== ResourceLevel.Node) continue;
      if (descriptor.restoreOn === ResourceScopeTarget.Resource) {
        await this.permissionService.validPermissions(
          row.resourceId,
          [descriptor.actions.create],
          accessTokenId,
          true
        );
        continue;
      }
      scopes.add(descriptor.actions.create);
    }
    if (scopes.size === 0) return;
    await this.permissionService.validPermissions(baseId, [...scopes], accessTokenId, true);
  }

  /** All a folder holds is checked before the first purge, not one at a time as it goes. */
  private async assertPurgePermitted(baseId: string, rows: { resourceType: string }[]) {
    const scopes = new Set<Action>(['base|update']);
    for (const row of rows) {
      const descriptor = resourceDescriptorOf(row.resourceType);
      if (descriptor?.level === ResourceLevel.Node) scopes.add(descriptor.actions.delete);
    }
    const accessTokenId = this.cls.get('accessTokenId');
    await this.permissionService.validPermissions(baseId, [...scopes], accessTokenId, true);
  }
}
