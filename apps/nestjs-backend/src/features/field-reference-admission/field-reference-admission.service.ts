import { Injectable, Logger } from '@nestjs/common';
import { FieldType, HttpErrorCode } from '@teable/core';
import type { IFieldVo } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { CustomHttpException } from '../../custom.exception';
import { isCrossSpaceReferenceAllowed, parseFieldJson } from '../base/cross-space-detection.util';
import { CrossBaseLinkAccessService } from '../record/cross-base-link-access.service';

/** Host reference admission shared by legacy execution and native v2 consumers. */
@Injectable()
export class FieldReferenceAdmissionService {
  private readonly logger = new Logger(FieldReferenceAdmissionService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly crossBaseLinkAccess: CrossBaseLinkAccessService
  ) {}

  private async isCrossSpaceTarget(tableId: string, foreignTableId: string): Promise<boolean> {
    // The escape hatch also disables field-duplicate downgrade, in one place.
    if (isCrossSpaceReferenceAllowed()) return false;
    if (!foreignTableId || tableId === foreignTableId) return false;
    const rows = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: [tableId, foreignTableId] }, deletedTime: null },
      select: { id: true, base: { select: { spaceId: true } } },
    });
    const spaceMap = new Map(rows.map((row) => [row.id, row.base.spaceId]));
    const selfSpace = spaceMap.get(tableId);
    const foreignSpace = spaceMap.get(foreignTableId);
    return Boolean(selfSpace && foreignSpace && selfSpace !== foreignSpace);
  }

  async assertSameSpaceLinkTarget(tableId: string, foreignTableId: string): Promise<void> {
    if (!(await this.isCrossSpaceTarget(tableId, foreignTableId))) return;
    this.logger.warn(
      `[cross-space] reject create: tableId=${tableId} foreignTableId=${foreignTableId}`
    );
    throw new CustomHttpException(
      `Cross-space link is no longer supported (foreignTableId: ${foreignTableId})`,
      HttpErrorCode.VALIDATION_ERROR,
      {
        localization: {
          i18nKey: 'httpErrors.field.crossSpaceLinkForbidden',
          context: { foreignTableId },
        },
      }
    );
  }

  // Link / ConditionalRollup store the reference in options; Lookup / Rollup /
  // ConditionalLookup store it in lookupOptions. Raw Prisma JSON and parsed DTOs
  // share this classification; parseFieldJson short-circuits parsed objects.
  private getForeignTableId(field: {
    type: string;
    isLookup?: boolean | null;
    options?: unknown;
    lookupOptions?: unknown;
  }): string | undefined {
    const readFt = (raw: unknown): string | undefined => {
      const blob = parseFieldJson(raw);
      const value = blob?.foreignTableId;
      return typeof value === 'string' && value ? value : undefined;
    };
    if (field.type === FieldType.Link && !field.isLookup) {
      return readFt(field.options);
    }
    if (field.type === FieldType.ConditionalRollup) {
      return readFt(field.options);
    }
    if (field.isLookup || field.type === FieldType.Rollup) {
      return readFt(field.lookupOptions);
    }
    return undefined;
  }

  async isCrossSpaceField(
    tableId: string,
    field: {
      type: string;
      isLookup?: boolean | null;
      options?: unknown;
      lookupOptions?: unknown;
    }
  ): Promise<boolean> {
    const foreignTableId = this.getForeignTableId(field);
    if (!foreignTableId) return false;
    return this.isCrossSpaceTarget(tableId, foreignTableId);
  }

  /** Only newly introduced references need admission; unchanged legacy refs remain valid. */
  async assertNewFieldReferencesAllowed(
    tableId: string,
    newField: IFieldVo,
    oldField?: IFieldVo
  ): Promise<void> {
    const newForeignTableId = this.getForeignTableId(newField);
    if (!newForeignTableId) return;
    if (oldField && this.getForeignTableId(oldField) === newForeignTableId) return;
    await this.assertNewForeignTableAllowed(tableId, newForeignTableId);
  }

  /** Same-space first, then caller read access in the foreign table's actual base. */
  async assertNewForeignTableAllowed(tableId: string, foreignTableId: string): Promise<void> {
    await this.assertSameSpaceLinkTarget(tableId, foreignTableId);
    await this.crossBaseLinkAccess.assertForeignTableReadable(tableId, foreignTableId);
  }

  /** Host field reads (including filter-link) do not inherit access to a foreign base. */
  async assertForeignTableReadable(tableId: string, foreignTableId: string): Promise<void> {
    await this.crossBaseLinkAccess.assertForeignTableReadable(tableId, foreignTableId);
  }

  /** The foreign tables a multi-table read through `tableId` may include; see the access service. */
  async readableForeignTableIds(
    tableId: string,
    foreignTableIds: Iterable<string>
  ): Promise<Set<string>> {
    return this.crossBaseLinkAccess.readableForeignTableIds(tableId, foreignTableIds);
  }
}
