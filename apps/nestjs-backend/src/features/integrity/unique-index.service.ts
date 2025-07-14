import { Injectable } from '@nestjs/common';
import { IdPrefix } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { IntegrityIssueType, type IIntegrityIssue } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { FieldService } from '../field/field.service';

@Injectable()
export class UniqueIndexService {
  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    private readonly fieldService: FieldService
  ) {}

  async checkUniqueIndex(table: {
    id: string;
    name: string;
    dbTableName: string;
  }): Promise<IIntegrityIssue[]> {
    const issues: IIntegrityIssue[] = [];

    const colId = '__id';
    const idUniqueIndexExists =
      (await this.fieldService.findUniqueIndexesForField(table.dbTableName, colId)).length > 0;

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
      const indexNames = await this.fieldService.findUniqueIndexesForField(
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

      const indexName = this.fieldService.getFieldUniqueKeyName(
        table.dbTableName,
        field.dbFieldName,
        fieldId
      );

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
    await this.prismaService.txClient().$executeRawUnsafe(sql);

    return {
      type: IntegrityIssueType.UniqueIndexNotFound,
      fieldId,
      message: `Unique index ${fieldId} fixed for table ${table.name}`,
    };
  }
}
