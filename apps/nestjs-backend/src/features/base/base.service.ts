import { Injectable, Logger } from '@nestjs/common';
import { IdPrefix } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { RecordService } from '../record/record.service';

@Injectable()
export class BaseService {
  private logger = new Logger(BaseService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService
  ) {}

  async sqlQuery(tableId: string, viewId: string, sql: string) {
    this.logger.log('sqlQuery:sql: ' + sql);
    const { queryBuilder } = await this.recordService.buildQuery(this.prismaService, tableId, {
      type: IdPrefix.Record,
      viewId,
      limit: -1,
    });
    const baseQuery = queryBuilder.toString();
    const { dbTableName } = await this.prismaService.tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });

    const combinedQuery = `
      WITH base AS (${baseQuery})
      ${sql.replace(dbTableName, 'base')};
    `;
    this.logger.log('sqlQuery:sql:combine: ' + combinedQuery);

    return this.prismaService.$queryRawUnsafe(combinedQuery);
  }
}
