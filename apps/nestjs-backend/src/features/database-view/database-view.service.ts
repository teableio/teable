import { Injectable, Logger } from '@nestjs/common';
import type { TableDomain } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { DatabaseRouter } from '../../global/database-router.service';
import { DATA_KNEX } from '../../global/knex/knex.module';
import { V2RecordQueryPlanService, toKnexRecordQuery } from '../v2/v2-record-query-plan.service';
import type { IDatabaseView } from './database-view.interface';

@Injectable()
export class DatabaseViewService implements IDatabaseView {
  private readonly logger = new Logger(DatabaseViewService.name);

  constructor(
    @InjectDbProvider()
    private readonly dbProvider: IDbProvider,
    @InjectModel(DATA_KNEX) private readonly knex: Knex,
    private readonly prisma: PrismaService,
    private readonly databaseRouter: DatabaseRouter,
    private readonly recordQueryPlanService: V2RecordQueryPlanService
  ) {}

  public async createView(table: TableDomain) {
    const plan = await this.recordQueryPlanService.compileDatabaseView(table.id);
    const qb = this.knex
      .queryBuilder()
      .select('*')
      .from(this.knex.raw('(?) as ??', [toKnexRecordQuery(this.knex, plan), 'source']));
    const sqls = this.dbProvider.createDatabaseView(table, qb, { materialized: true });
    const viewName = this.dbProvider.generateDatabaseViewName(table.id);

    await this.databaseRouter.dataPrismaTransactionForTable(table.id, async (tx) => {
      for (const sql of sqls) await tx.$executeRawUnsafe(sql);
      const refresh = this.dbProvider.refreshDatabaseView(table.id, { concurrently: false });
      if (refresh) await tx.$executeRawUnsafe(refresh);
    });

    try {
      await this.prisma.tableMeta.update({
        where: { id: table.id },
        data: { dbViewName: viewName },
      });
    } catch (error) {
      await this.dropDataView(table.id).catch((cleanupError) => {
        this.logger.error(
          `Failed to clean up database view ${viewName} after metadata update failure: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          cleanupError instanceof Error ? cleanupError.stack : undefined
        );
      });
      throw error;
    }
  }

  public async recreateView(table: TableDomain) {
    const plan = await this.recordQueryPlanService.compileDatabaseView(table.id);
    const qb = this.knex
      .queryBuilder()
      .select('*')
      .from(this.knex.raw('(?) as ??', [toKnexRecordQuery(this.knex, plan), 'source']));
    const sqls = this.dbProvider.recreateDatabaseView(table, qb);
    await this.databaseRouter.dataPrismaTransactionForTable(table.id, async (tx) => {
      for (const sql of sqls) await tx.$executeRawUnsafe(sql);
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
      await this.databaseRouter.executeDataPrismaForTable(tableId, sql);
    }
  }

  public async refreshViewsByFieldIds(fieldIds: string[]) {
    if (!fieldIds?.length) return;
    const tableIds = await this.getRelatedTableIdsByFieldIds(fieldIds);
    for (const tableId of tableIds) {
      const sql = this.dbProvider.refreshDatabaseView(tableId, { concurrently: true });
      if (sql) {
        await this.databaseRouter.executeDataPrismaForTable(tableId, sql);
      }
    }
  }

  private async getRelatedTableIdsByFieldIds(startFieldIds: string[]): Promise<string[]> {
    const visited = new Set<string>();
    const queue = [...startFieldIds];
    const tableIds = new Set<string>();
    const initial = await this.prisma.txClient().field.findMany({
      where: { id: { in: startFieldIds }, deletedTime: null },
      select: { tableId: true },
    });
    for (const field of initial) tableIds.add(field.tableId);
    for (let index = 0; index < queue.length; index++) {
      const fieldId = queue[index];
      if (visited.has(fieldId)) continue;
      visited.add(fieldId);
      for (const key of ['lookupFieldId', 'linkFieldId'] as const) {
        const query = this.dbProvider.lookupOptionsQuery(key, fieldId);
        const dependencies = await this.prisma
          .txClient()
          .$queryRawUnsafe<{ tableId: string; id: string }[]>(query);
        for (const dependency of dependencies) {
          tableIds.add(dependency.tableId);
          queue.push(dependency.id);
        }
      }
    }
    return [...tableIds];
  }

  private async dropDataView(tableId: string) {
    const sqls = this.dbProvider.dropDatabaseView(tableId);
    await this.databaseRouter.dataPrismaTransactionForTable(tableId, async (tx) => {
      for (const sql of sqls) {
        await tx.$executeRawUnsafe(sql);
      }
    });
  }
}
