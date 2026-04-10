import { Injectable } from '@nestjs/common';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ComputedOrchestratorService } from './computed-orchestrator.service';

@Injectable()
export class PersistedComputedBackfillService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly computedOrchestrator: ComputedOrchestratorService
  ) {}

  async recomputeForTables(tableIds: string[]) {
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

    const byTable = new Map<string, string[]>();
    for (const field of fields) {
      const isLinkDisplayField = field.type === FieldType.Link && !field.isLookup;
      const isPersistedComputedField = Boolean(field.isComputed);
      if (!isLinkDisplayField && !isPersistedComputedField) {
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
