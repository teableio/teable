import { Injectable, Logger } from '@nestjs/common';
import type { TableDomain } from '@teable/core';
import { DataPrismaService } from '@teable/db-data-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { ReferenceService } from '../calculation/reference.service';
import { InjectRecordQueryBuilder, IRecordQueryBuilder } from '../record/query-builder';
import type { IDatabaseView } from './database-view.interface';

@Injectable()
export class DatabaseViewService implements IDatabaseView {
  private readonly logger = new Logger(DatabaseViewService.name);

  constructor(
    @InjectDbProvider()
    private readonly dbProvider: IDbProvider,
    @InjectRecordQueryBuilder()
    private readonly recordQueryBuilderService: IRecordQueryBuilder,
    private readonly prisma: PrismaService,
    private readonly dataPrisma: DataPrismaService,
    private readonly referenceService: ReferenceService
  ) {}

  public async createView(table: TableDomain) {
    const { qb } = await this.recordQueryBuilderService.prepareView(table.dbTableName, {
      tableIdOrDbTableName: table.id,
    });
    const sqls = this.dbProvider.createDatabaseView(table, qb, { materialized: true });
    const viewName = this.dbProvider.generateDatabaseViewName(table.id);

    await this.dataPrisma.$tx(async (tx) => {
      for (const sql of sqls) {
        await tx.$executeRawUnsafe(sql);
      }

      const refresh = this.dbProvider.refreshDatabaseView(table.id, { concurrently: false });
      if (refresh) {
        await tx.$executeRawUnsafe(refresh);
      }
    });

    try {
      await this.prisma.tableMeta.update({
        where: { id: table.id },
        data: { dbViewName: viewName },
      });
    } catch (error) {
      await this.dropDataView(table.id).catch((cleanupError) => {
        this.logger.error(
          `Failed to clean up database view ${viewName} after metadata update failure: ${
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          }`,
          cleanupError instanceof Error ? cleanupError.stack : undefined
        );
      });
      throw error;
    }
  }

  public async recreateView(table: TableDomain) {
    const { qb } = await this.recordQueryBuilderService.prepareView(table.dbTableName, {
      tableIdOrDbTableName: table.id,
    });

    const sqls = this.dbProvider.recreateDatabaseView(table, qb);
    await this.dataPrisma.$tx(async (tx) => {
      for (const sql of sqls) {
        await tx.$executeRawUnsafe(sql);
      }
    });
  }

  public async dropView(tableId: string) {
    await this.dropDataView(tableId);

    await this.prisma.tableMeta.update({
      where: { id: tableId },
      data: { dbViewName: null },
    });
  }

  public async refreshView(tableId: string) {
    const sql = this.dbProvider.refreshDatabaseView(tableId, { concurrently: true });
    if (sql) {
      await this.dataPrisma.$executeRawUnsafe(sql);
    }
  }

  public async refreshViewsByFieldIds(fieldIds: string[]) {
    if (!fieldIds?.length) return;
    const tableIds = await this.referenceService.getRelatedTableIdsByFieldIds(fieldIds);
    for (const tableId of tableIds) {
      const sql = this.dbProvider.refreshDatabaseView(tableId, { concurrently: true });
      if (sql) {
        await this.dataPrisma.$executeRawUnsafe(sql);
      }
    }
  }

  private async dropDataView(tableId: string) {
    const sqls = this.dbProvider.dropDatabaseView(tableId);
    await this.dataPrisma.$tx(async (tx) => {
      for (const sql of sqls) {
        await tx.$executeRawUnsafe(sql);
      }
    });
  }
}
