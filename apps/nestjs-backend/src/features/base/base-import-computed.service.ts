import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import {
  TableByIdSpec,
  TableId,
  v2CoreTokens,
  type IComputedFieldBackfillService,
  type ITableRepository,
  type IUnitOfWork,
  type Table,
} from '@teable/v2-core';
import { V2ContainerService } from '../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../v2/v2-execution-context.factory';

/** Complete computed storage after the compatibility archive reader commits raw row/junction chunks. */
@Injectable()
export class BaseImportComputedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly containers: V2ContainerService,
    private readonly contexts: V2ExecutionContextFactory
  ) {}

  async recomputeForTables(tableIds: string[]) {
    const grouped = new Map<string, string[]>();
    const rows = await this.prisma.txClient().tableMeta.findMany({
      where: { id: { in: tableIds }, deletedTime: null },
      select: { id: true, baseId: true },
    });
    for (const row of rows) {
      const ids = grouped.get(row.baseId) ?? [];
      ids.push(row.id);
      grouped.set(row.baseId, ids);
    }
    for (const [baseId, ids] of grouped) {
      const container = await this.containers.getContainerForBase(baseId);
      const context = await this.contexts.createContext(container);
      const repository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
      const tables: Table[] = [];
      for (const id of ids) {
        const tableId = TableId.create(id);
        if (tableId.isErr()) {
          throw new Error(
            `Invalid table ID ${id} during computed backfill for base ${baseId}: ${tableId.error.message}`
          );
        }
        const spec = TableByIdSpec.create(tableId.value);
        const table = await repository.findOne(context, spec);
        if (table.isErr()) {
          throw new Error(
            `Failed to load table ${id} for computed backfill in base ${baseId}: ${table.error.message}`
          );
        }
        tables.push(table.value);
      }
      const backfill = container.resolve<IComputedFieldBackfillService>(
        v2CoreTokens.computedFieldBackfillService
      );
      const unitOfWork = container.resolve<IUnitOfWork>(v2CoreTokens.unitOfWork);
      // Keep SET LOCAL backfill policies on the same routed connection as its UPDATEs.
      const result = await unitOfWork.withTransaction(
        context,
        (transactionContext) =>
          backfill.executeSyncTables(transactionContext, { tables, includeOneManyTwoWay: true }),
        { scope: 'data', retry: false }
      );
      if (result.isErr()) {
        throw new Error(
          `Computed backfill failed for base ${baseId} tables (${ids.join(', ')}): ${result.error.message}`
        );
      }
    }
  }
}
