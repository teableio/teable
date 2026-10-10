import { Injectable } from '@nestjs/common';
import { FieldType, isRobot } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { PermissionService } from '../auth/permission.service';

interface ILinkFieldRow {
  id: string;
  name: string;
  dbFieldName: string;
  options: string | null;
  isLookup: boolean | null;
}

const matchesKey = (field: ILinkFieldRow, keys: Set<string> | undefined) =>
  !keys || keys.has(field.id) || keys.has(field.name) || keys.has(field.dbFieldName);

const collectForeignTableIds = (
  fields: ILinkFieldRow[],
  keys: Set<string> | undefined
): Set<string> => {
  const foreignTableIds = new Set<string>();
  for (const field of fields) {
    if (field.isLookup || !field.options || !matchesKey(field, keys)) {
      continue;
    }
    const options = JSON.parse(field.options) as { foreignTableId?: string };
    if (options.foreignTableId) {
      foreignTableIds.add(options.foreignTableId);
    }
  }
  return foreignTableIds;
};

/**
 * Inside one base, reading a foreign table is covered by the caller's role on
 * the base; across bases it is not, and the request guard only checks the host
 * table. Two places reach into the foreign table and repeat that check here:
 * - writing a link cell by title (typecast, paste) looks the titles up there,
 *   an existence and title oracle otherwise (GHSA-vqm3-2pqv-cx89);
 * - creating or converting a link, lookup or rollup field makes the foreign
 *   values readable through the host table (GHSA-p8x2-vpf5-3f6x).
 * Whether a foreign table is in another base comes from the table itself, never
 * from the `baseId` a client put in the link options.
 */
@Injectable()
export class CrossBaseLinkAccessService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  /**
   * Principals whose reach is decided elsewhere are not checked here:
   * - no user: an internal job (import, duplication, ...), not a caller probing another base;
   * - robots (automation/app tokens): no collaborator rows, scoped by tempAuthBaseId;
   * - share views: the share decides which linked records its visitors may pick.
   */
  private isExempt(): boolean {
    const userId = this.cls.get('user.id');
    return (
      !userId ||
      isRobot(userId) ||
      Boolean(this.cls.get('tempAuthBaseId')) ||
      Boolean(this.cls.get('shareViewId'))
    );
  }

  /**
   * @param fieldKeys the fields the write touches, as ids, names or db field
   * names; omit to check every link field of the table.
   */
  async assertForeignTablesReadable(tableId: string, fieldKeys?: Iterable<string>) {
    if (this.isExempt()) {
      return;
    }
    const keys = fieldKeys ? new Set(fieldKeys) : undefined;
    if (keys?.size === 0) {
      return;
    }

    const prisma = this.prismaService.txClient();
    const linkFields = await prisma.field.findMany({
      where: { tableId, type: FieldType.Link, deletedTime: null },
      select: { id: true, name: true, dbFieldName: true, options: true, isLookup: true },
    });
    await this.assertReadableAcrossBases(tableId, collectForeignTableIds(linkFields, keys));
  }

  /**
   * For a field about to reference `foreignTableId` from `tableId` (a new link,
   * lookup, rollup or conditional variant).
   */
  async assertForeignTableReadable(tableId: string, foreignTableId: string) {
    if (this.isExempt()) {
      return;
    }
    await this.assertReadableAcrossBases(tableId, new Set([foreignTableId]));
  }

  private async assertReadableAcrossBases(tableId: string, foreignTableIds: Set<string>) {
    foreignTableIds.delete(tableId);
    if (!foreignTableIds.size) {
      return;
    }
    const tables = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: [tableId, ...foreignTableIds] }, deletedTime: null },
      select: { id: true, baseId: true },
    });
    const baseIdByTable = new Map(tables.map(({ id, baseId }) => [id, baseId]));
    const hostBaseId = baseIdByTable.get(tableId);
    if (!hostBaseId) {
      return;
    }
    for (const foreignTableId of foreignTableIds) {
      const foreignBaseId = baseIdByTable.get(foreignTableId);
      // A missing foreign table is left to the caller's own not-found handling.
      if (!foreignBaseId || foreignBaseId === hostBaseId) {
        continue;
      }
      await this.permissionService.validPermissions(
        foreignTableId,
        ['record|read'],
        this.cls.get('accessTokenId')
      );
    }
  }
}
