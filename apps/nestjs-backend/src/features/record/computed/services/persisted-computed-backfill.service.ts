import { Injectable } from '@nestjs/common';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../../types/cls';
import { ComputedOrchestratorService } from './computed-orchestrator.service';

@Injectable()
export class PersistedComputedBackfillService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly computedOrchestrator: ComputedOrchestratorService
  ) {}

  async recomputeForTables(tableIds: string[]) {
    if (!this.cls.isActive()) {
      return this.cls.run(() => this.recomputeForTablesInContext(tableIds));
    }

    return this.recomputeForTablesInContext(tableIds);
  }

  private async recomputeForTablesInContext(tableIds: string[]) {
    if (!tableIds.length) {
      return;
    }

    const fields = await this.prismaService.txClient().field.findMany({
      where: {
        tableId: { in: tableIds },
        deletedTime: null,
      },
      select: { id: true, tableId: true, type: true, isLookup: true, isComputed: true },
    });

    const persistedComputedTypes = new Set<string>([
      FieldType.Formula,
      FieldType.Rollup,
      FieldType.ConditionalRollup,
    ]);

    const byTable = new Map<string, string[]>();
    for (const field of fields) {
      const isLinkDisplayField = field.type === FieldType.Link && !field.isLookup;
      const isLookupField = Boolean(field.isLookup);
      const isPersistedComputedField =
        Boolean(field.isComputed) || persistedComputedTypes.has(field.type);
      if (!isLinkDisplayField && !isLookupField && !isPersistedComputedField) {
        continue;
      }

      const fieldIds = byTable.get(field.tableId) ?? [];
      fieldIds.push(field.id);
      byTable.set(field.tableId, fieldIds);
    }

    if (!byTable.size) {
      return;
    }

    const sources = Array.from(byTable.entries()).map(([tableId, fieldIds]) => ({
      tableId,
      fieldIds,
    }));

    await this.computedOrchestrator.computeCellChangesForFieldsAfterCreate(sources, async () => {
      return;
    });
  }
}
