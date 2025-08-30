import { Injectable } from '@nestjs/common';
import type { TableDomain } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { ReferenceService } from '../calculation/reference.service';
import { InjectRecordQueryBuilder, IRecordQueryBuilder } from '../record/query-builder';
import type { IDatabaseView } from './database-view.interface';

@Injectable()
export class DatabaseViewService implements IDatabaseView {
  constructor(
    @InjectDbProvider()
    private readonly dbProvider: IDbProvider,
    @InjectRecordQueryBuilder()
    private readonly recordQueryBuilderService: IRecordQueryBuilder,
    private readonly prisma: PrismaService,
    private readonly referenceService: ReferenceService
  ) {}

  public async createView(table: TableDomain) {
    const { qb } = await this.recordQueryBuilderService.prepareView(table.dbTableName, {
      tableIdOrDbTableName: table.id,
    });
    const sqls = this.dbProvider.createDatabaseView(table, qb, { materialized: true });
    await this.prisma.$transaction(async (tx) => {
      for (const sql of sqls) {
        await tx.$executeRawUnsafe(sql);
      }
      const viewName = this.dbProvider.generateDatabaseViewName(table.id);
      await tx.tableMeta.update({
        where: { id: table.id },
        data: { dbViewName: viewName },
      });

      const refresh = this.dbProvider.refreshDatabaseView(table.id, { concurrently: false });
      if (refresh) {
        await tx.$executeRawUnsafe(refresh);
      }
    });
    // persist view name to table meta
  }

  public async recreateView(table: TableDomain) {
    const { qb } = await this.recordQueryBuilderService.prepareView(table.dbTableName, {
      tableIdOrDbTableName: table.id,
    });

    const sqls = this.dbProvider.recreateDatabaseView(table, qb);
    await this.prisma.$transaction(sqls.map((s) => this.prisma.$executeRawUnsafe(s)));
  }

  public async dropView(tableId: string) {
    const sqls = this.dbProvider.dropDatabaseView(tableId);
    for (const sql of sqls) {
      await this.prisma.$executeRawUnsafe(sql);
    }
    // clear persisted view name
    await this.prisma.tableMeta.update({
      where: { id: tableId },
      data: { dbViewName: null },
    });
  }

  public async refreshView(tableId: string) {
    const sql = this.dbProvider.refreshDatabaseView(tableId, { concurrently: true });
    if (sql) {
      await this.prisma.$executeRawUnsafe(sql);
    }
  }

  public async refreshViewsByFieldIds(fieldIds: string[]) {
    if (!fieldIds?.length) return;
    const tableIds = await this.referenceService.getRelatedTableIdsByFieldIds(fieldIds);
    for (const tableId of tableIds) {
      const sql = this.dbProvider.refreshDatabaseView(tableId, { concurrently: true });
      if (sql) {
        await this.prisma.$executeRawUnsafe(sql);
      }
    }
  }
}
