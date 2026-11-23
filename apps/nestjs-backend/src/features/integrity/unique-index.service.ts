import { Injectable } from '@nestjs/common';
import { IdPrefix } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { IntegrityIssueType, type IIntegrityIssue } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { DatabaseRouter } from '../../global/database-router.service';
import { DATA_KNEX } from '../../global/knex/knex.module';

@Injectable()
export class UniqueIndexService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly databaseRouter: DatabaseRouter,
    @InjectModel(DATA_KNEX) private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {}

  async checkUniqueIndex(table: {
    id: string;
    name: string;
    dbTableName: string;
  }): Promise<IIntegrityIssue[]> {
    const issues: IIntegrityIssue[] = [];

    const colId = '__id';
    const idUniqueIndexExists =
      (await this.findUniqueIndexesForField(table.id, table.dbTableName, colId)).length > 0;

    if (!idUniqueIndexExists) {
      issues.push({
        fieldId: colId,
        type: IntegrityIssueType.UniqueIndexNotFound,
        message: `Unique index ${colId} not found for table ${table.name}`,
      });
    }

    const uniqueFields = await this.prismaService.field.findMany({
      where: { tableId: table.id, deletedTime: null, unique: true },
      select: { id: true, dbFieldName: true },
    });

    for (const field of uniqueFields) {
      const indexNames = await this.findUniqueIndexesForField(
        table.id,
        table.dbTableName,
        field.dbFieldName
      );
      if (indexNames.length === 0) {
        issues.push({
          fieldId: field.id,
          type: IntegrityIssueType.UniqueIndexNotFound,
          message: `Unique index ${field.id} not found for table ${table.name}`,
        });
      }
    }
    return issues;
  }

  async fixUniqueIndex(tableId?: string, fieldId?: string): Promise<IIntegrityIssue | undefined> {
    if (!tableId || !fieldId) {
      return;
    }

    const table = await this.prismaService.tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true, name: true },
    });

    let sql: string | undefined;
    if (fieldId.startsWith('__')) {
      sql = this.knex.schema
        .alterTable(table.dbTableName, (table) => {
          table.unique([fieldId]);
        })
        .toQuery();
    } else if (fieldId.startsWith(IdPrefix.Field)) {
      const field = await this.prismaService.field.findFirstOrThrow({
        where: { id: fieldId, deletedTime: null },
        select: { dbFieldName: true },
      });

      const [schema, tableName] = this.dbProvider.splitTableName(table.dbTableName);
      const suffix = `___${fieldId}_unique`;
      const prefix = `${schema}_${tableName}`.slice(0, 63 - suffix.length);
      const indexName = `${prefix.toLowerCase()}${suffix.toLowerCase()}`;

      sql = this.knex.schema
        .alterTable(table.dbTableName, (table) => {
          table.unique([field.dbFieldName], {
            indexName,
          });
        })
        .toQuery();
    }

    if (!sql) {
      return;
    }
    await this.databaseRouter.executeDataPrismaForTable(tableId, sql, { useTransaction: true });

    return {
      type: IntegrityIssueType.UniqueIndexNotFound,
      fieldId,
      message: `Unique index ${fieldId} fixed for table ${table.name}`,
    };
  }

  private async findUniqueIndexesForField(
    tableId: string,
    dbTableName: string,
    dbFieldName: string
  ) {
    const indexes = await this.databaseRouter.queryDataPrismaForTable<
      { name: string; columns: string; isUnique: boolean }[]
    >(tableId, this.dbProvider.getTableIndexes(dbTableName));
    return indexes
      .filter(
        ({ columns, isUnique }) =>
          isUnique && (JSON.parse(columns) as string[]).includes(dbFieldName)
      )
      .map(({ name }) => name);
  }
}
