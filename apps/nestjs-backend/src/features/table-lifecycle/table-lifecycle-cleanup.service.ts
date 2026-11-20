import { Injectable, Logger } from '@nestjs/common';
import { IdPrefix } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ResourceType } from '@teable/openapi';
import type { IDataDbRoutingOptions } from '../../global/data-db-client-manager.service';
import {
  classifyDataDbRuntimeError,
  handleBestEffortDataDbDropError,
} from '../../global/data-db-runtime-error';
import { DatabaseRouter } from '../../global/database-router.service';
import { RawOpType } from '../../share-db/interface';
import { RawOpStagingService } from '../../share-db/raw-op-staging.service';
import { RecordHistoryColdStorageService } from '../record-history-cold/record-history-cold-storage.service';
import { TableMutationCacheInvalidator } from '../table/open-api/table-mutation-cache-invalidator';

/** Host metadata, sidecar storage and physical-retirement policy shared by lifecycle callers. */
@Injectable()
export class TableLifecycleCleanupService {
  private readonly logger = new Logger(TableLifecycleCleanupService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly databaseRouter: DatabaseRouter,
    private readonly rawOpStagingService: RawOpStagingService,
    private readonly tableMutationCacheInvalidator: TableMutationCacheInvalidator,
    private readonly recordHistoryColdStorage: RecordHistoryColdStorageService
  ) {}

  async captureNativePurgeState(tableId: string) {
    const [table, fields] = await Promise.all([
      this.prismaService.txClient().tableMeta.findUnique({
        where: { id: tableId },
        select: { dbTableName: true },
      }),
      this.prismaService.txClient().field.findMany({
        where: { tableId },
        select: { id: true },
      }),
    ]);
    if (!table) {
      return undefined;
    }
    return { dbTableName: table.dbTableName, fieldIds: fields.map(({ id }) => id) };
  }

  /** DB metadata & sidecar cleanup commit atomically in TableDeleted; only cache & S3 run post-commit. */
  async cleanupAfterNativePurge(
    baseId: string,
    tableId: string,
    state: { dbTableName: string; fieldIds: string[] }
  ): Promise<void> {
    try {
      await this.tableMutationCacheInvalidator.invalidateDroppedTable(state.dbTableName);
    } catch (error) {
      handleBestEffortDataDbDropError({
        error,
        isMetaFallback: await this.databaseRouter.isMetaFallbackForBase(baseId),
        logger: this.logger,
        target: `mutation cache for table ${tableId}`,
      });
    }
    await this.cleanupColdHistoryPrefixes([tableId]);
  }

  /** Only the admitted native retention boundary calls this after a failed routed attempt. */
  async cleanupUnavailableRetainedTable(
    baseId: string,
    tableId: string,
    state: { dbTableName: string; fieldIds: string[] },
    error: unknown
  ): Promise<void> {
    const admitUnavailableFailure = async (failure: unknown) => {
      const classification = classifyDataDbRuntimeError(failure);
      if (
        !classification ||
        classification.retryable ||
        !['data_db.tenant_missing', 'data_db.database_missing', 'data_db.auth_failed'].includes(
          classification.code
        )
      ) {
        throw failure;
      }
      handleBestEffortDataDbDropError({
        error: failure,
        isMetaFallback: await this.databaseRouter.isMetaFallbackForBase(baseId),
        logger: this.logger,
        target: `retained table ${tableId}`,
      });
    };
    await admitUnavailableFailure(error);

    await this.prismaService.$tx(async () => {
      try {
        await this.tableMutationCacheInvalidator.invalidateDroppedTable(state.dbTableName);
      } catch (cacheError) {
        await admitUnavailableFailure(cacheError);
      }
      await this.cleanReferenceFieldIds([tableId]);
      await this.cleanTaskRelatedData([tableId], state.fieldIds);
      await this.cleanTablesRelatedData(baseId, [tableId], undefined, {
        skipExternalDataDbCleanup: true,
      });
    });
    await this.cleanupColdHistoryPrefixes([tableId]);
  }

  /**
   * Best-effort removal of the tables' cold-history prefixes on the private
   * bucket. The delete is irreversible, so it must only run AFTER the DB purge
   * transaction has committed — never inside it (a rollback would restore the
   * table without its cold history). An S3 miss never fails the purge;
   * leftover prefixes are reconciled by ops tooling against table existence.
   */
  async cleanupColdHistoryPrefixes(tableIds: string[]) {
    for (const tableId of tableIds) {
      await this.recordHistoryColdStorage
        .deleteTablePrefix(tableId)
        .catch((error) =>
          this.logger.warn(`failed to delete cold history prefix for ${tableId}: ${error}`)
        );
    }
  }

  async dropTables(tableIds: string[]) {
    const tables = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: tableIds } },
      select: { dbTableName: true, version: true, id: true, baseId: true, deletedTime: true },
    });
    for (const table of tables) {
      if (!table.deletedTime) {
        this.rawOpStagingService.saveRawOps(table.baseId, RawOpType.Del, IdPrefix.Table, [
          { docId: table.id, version: table.version },
        ]);
      }
      try {
        await this.databaseRouter.executeDataPrismaForTable(
          table.id,
          this.databaseRouter
            .dataKnex()
            .raw('DROP TABLE IF EXISTS ?? CASCADE', [table.dbTableName])
            .toQuery(),
          { useTransaction: true }
        );
      } catch (error) {
        handleBestEffortDataDbDropError({
          error,
          isMetaFallback: await this.databaseRouter.isMetaFallbackForBase(table.baseId, {
            useTransaction: true,
          }),
          logger: this.logger,
          target: `table ${table.id}`,
        });
      }
      try {
        await this.tableMutationCacheInvalidator.invalidateDroppedTable(table.dbTableName);
      } catch (error) {
        handleBestEffortDataDbDropError({
          error,
          isMetaFallback: await this.databaseRouter.isMetaFallbackForBase(table.baseId, {
            useTransaction: true,
          }),
          logger: this.logger,
          target: `mutation cache for table ${table.id}`,
        });
      }
    }
  }

  async cleanTaskRelatedData(tableIds: string[], capturedFieldIds?: string[]) {
    const alternativeFields =
      capturedFieldIds === undefined
        ? await this.prismaService.txClient().field.findMany({
            where: { tableId: { in: tableIds } },
            select: { id: true },
          })
        : capturedFieldIds.map((id) => ({ id }));
    const alternativeFieldIds = alternativeFields.map((field) => field.id);

    // clean task reference for fields
    await this.prismaService.txClient().taskReference.deleteMany({
      where: {
        OR: [
          { fromFieldId: { in: alternativeFieldIds } },
          { toFieldId: { in: alternativeFieldIds } },
        ],
      },
    });

    // clean task for table
    await this.prismaService.txClient().task.deleteMany({
      where: {
        OR: tableIds.map((tableId) => ({
          snapshot: {
            contains: `"tableId":"${tableId}"`,
          },
        })),
      },
    });
  }

  async cleanReferenceFieldIds(tableIds: string[]) {
    // Every dependency edge that touches a dropped table dangles once its field rows go,
    // so the endpoint list must not be pre-filtered by type: a lookup field keeps only its
    // inner type, which hid a number-typed lookup and its plain source from a
    // Link/Formula filter and left the edge behind after a permanent wipe (T7365).
    const fields = await this.prismaService.txClient().field.findMany({
      where: { tableId: { in: tableIds } },
      select: { id: true },
    });
    const fieldIds = fields.map((field) => field.id);
    await this.prismaService.txClient().reference.deleteMany({
      where: { OR: [{ fromFieldId: { in: fieldIds } }, { toFieldId: { in: fieldIds } }] },
    });
  }

  async cleanTablesRelatedData(
    baseId: string,
    tableIds: string[],
    routingOptions?: IDataDbRoutingOptions,
    options?: { skipExternalDataDbCleanup?: boolean }
  ) {
    const metaPrisma = this.prismaService.txClient();

    // delete field for table
    await metaPrisma.field.deleteMany({
      where: { tableId: { in: tableIds } },
    });

    // delete view for table
    await metaPrisma.view.deleteMany({
      where: { tableId: { in: tableIds } },
    });

    // comments live on the meta DB keyed by table id, with no cascade from tableMeta
    await metaPrisma.comment.deleteMany({
      where: { tableId: { in: tableIds } },
    });
    await metaPrisma.commentSubscription.deleteMany({
      where: { tableId: { in: tableIds } },
    });

    // clean attachment for table
    await metaPrisma.attachmentsTable.deleteMany({
      where: { tableId: { in: tableIds } },
    });

    // clear ops for view/field/record
    await metaPrisma.ops.deleteMany({
      where: { collection: { in: tableIds } },
    });

    // clean ops for table
    await metaPrisma.ops.deleteMany({
      where: { collection: baseId, docId: { in: tableIds } },
    });

    await metaPrisma.tableMeta.deleteMany({
      where: { id: { in: tableIds } },
    });

    // Explicit forced space removal and admitted, permanently unavailable table retention leave
    // external history/trash behind. Do not resolve that client: resolution may migrate/connect.
    if (!options?.skipExternalDataDbCleanup) {
      // Nested so a missing bound relation does not prevent purging the others.
      const bestEffort = async (target: string, purge: () => Promise<unknown>) => {
        try {
          await purge();
        } catch (error) {
          handleBestEffortDataDbDropError({
            error,
            isMetaFallback: await this.databaseRouter.isMetaFallbackForBase(baseId, routingOptions),
            logger: this.logger,
            target,
          });
        }
      };
      const tables = tableIds.join(', ');
      await bestEffort(`data database for base ${baseId}`, async () => {
        const routedDataPrisma = await this.databaseRouter.dataPrismaForBase(
          baseId,
          routingOptions
        );
        const dataPrisma =
          'txClient' in routedDataPrisma && typeof routedDataPrisma.txClient === 'function'
            ? routedDataPrisma.txClient()
            : routedDataPrisma;
        const where = { tableId: { in: tableIds } };

        await bestEffort(`attachment refs for tables ${tables}`, () =>
          dataPrisma.attachmentsTable.deleteMany({ where })
        );
        await bestEffort(`record history for tables ${tables}`, () =>
          dataPrisma.recordHistory.deleteMany({ where })
        );
        await bestEffort(`table trash for tables ${tables}`, () =>
          dataPrisma.tableTrash.deleteMany({ where })
        );
        await bestEffort(`record trash for tables ${tables}`, () =>
          dataPrisma.recordTrash.deleteMany({ where })
        );
      });
    }

    // clean trash for table
    await metaPrisma.trash.deleteMany({
      where: { resourceId: { in: tableIds }, resourceType: ResourceType.Table },
    });
  }
}
