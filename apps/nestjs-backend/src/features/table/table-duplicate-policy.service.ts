import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICrossSpaceTableAffectedField } from '@teable/openapi';
import {
  collectCrossSpaceAffectedFieldIds,
  extractForeignTableId,
  isCrossSpaceReferenceAllowed,
} from '../base/cross-space-detection.util';

/** Host space-placement policy; it never enters either table engine. */
@Injectable()
export class TableDuplicatePolicyService {
  constructor(private readonly prismaService: PrismaService) {}

  async previewFieldDuplicateCrossSpace(
    tableId: string,
    fieldId: string
  ): Promise<ICrossSpaceTableAffectedField[]> {
    return (await this.previewCrossSpaceAffectedFields(tableId)).filter(
      (field) => field.fieldId === fieldId
    );
  }

  async previewCrossSpaceAffectedFields(
    sourceTableId: string,
    targetTableId: string = sourceTableId
  ): Promise<ICrossSpaceTableAffectedField[]> {
    if (isCrossSpaceReferenceAllowed()) return [];
    const prisma = this.prismaService.txClient();
    const fields = await prisma.field.findMany({
      where: { tableId: sourceTableId, deletedTime: null },
    });
    const foreignTableIds = [
      ...new Set(
        fields
          .map(extractForeignTableId)
          .filter((id): id is string => Boolean(id && id !== targetTableId))
      ),
    ];
    if (!foreignTableIds.length) return [];

    const tables = await prisma.tableMeta.findMany({
      where: { id: { in: [targetTableId, ...foreignTableIds] }, deletedTime: null },
      select: { id: true, base: { select: { spaceId: true } } },
    });
    const spaces = new Map(tables.map((table) => [table.id, table.base.spaceId]));
    const targetSpace = spaces.get(targetTableId);
    if (!targetSpace) return [];
    const affected = collectCrossSpaceAffectedFieldIds({
      fields,
      isForeignInternal: (id) => id === targetTableId,
      isForeignCrossSpace: (id) => {
        const space = spaces.get(id);
        return Boolean(space && space !== targetSpace);
      },
    });
    return fields
      .filter((field) => affected.has(field.id))
      .map((field) => ({ fieldId: field.id, fieldName: field.name, type: field.type }));
  }
}
