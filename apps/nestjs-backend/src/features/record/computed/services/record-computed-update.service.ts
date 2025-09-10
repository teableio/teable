import { Injectable, Logger } from '@nestjs/common';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../../../db-provider/db.provider';
import { IDbProvider } from '../../../../db-provider/db.provider.interface';
import type { IFieldInstance } from '../../../field/model/factory';
import type { FormulaFieldDto } from '../../../field/model/field-dto/formula-field.dto';

@Injectable()
export class RecordComputedUpdateService {
  private logger = new Logger(RecordComputedUpdateService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  private async getDbTableName(tableId: string): Promise<string> {
    const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return dbTableName;
  }

  private getUpdatableColumns(fields: IFieldInstance[]): string[] {
    const isFormulaField = (f: IFieldInstance): f is FormulaFieldDto =>
      f.type === FieldType.Formula;

    return fields
      .filter((f) => {
        // Skip formula persisted as generated columns
        if (isFormulaField(f) && f.getIsPersistedAsGeneratedColumn()) return false;
        // Skip fields persisted as generated columns (cannot be updated directly)
        switch (f.type) {
          case FieldType.AutoNumber:
          case FieldType.CreatedTime:
          case FieldType.LastModifiedTime:
          case FieldType.CreatedBy:
          case FieldType.LastModifiedBy:
            return false;
          default:
            break;
        }
        return true;
      })
      .map((f) => f.dbFieldName);
  }

  private getReturningColumns(fields: IFieldInstance[]): string[] {
    const isFormulaField = (f: IFieldInstance): f is FormulaFieldDto =>
      f.type === FieldType.Formula;
    const cols = fields.map((f) => {
      if (isFormulaField(f) && f.getIsPersistedAsGeneratedColumn()) {
        return f.getGeneratedColumnName();
      }
      return f.dbFieldName;
    });
    // de-dup
    return Array.from(new Set(cols));
  }

  async updateFromSelect(
    tableId: string,
    qb: Knex.QueryBuilder,
    fields: IFieldInstance[]
  ): Promise<Array<{ __id: string; __version: number } & Record<string, unknown>>> {
    const dbTableName = await this.getDbTableName(tableId);
    const columnNames = this.getUpdatableColumns(fields);
    const returningNames = this.getReturningColumns(fields);
    if (!columnNames.length) {
      // No updatable columns (e.g., all are generated formulas). Return current values via SELECT.
      return await this.prismaService
        .txClient()
        .$queryRawUnsafe<
          Array<{ __id: string; __version: number } & Record<string, unknown>>
        >(qb.toQuery());
    }

    const sql = this.dbProvider.updateFromSelectSql({
      dbTableName,
      idFieldName: '__id',
      subQuery: qb,
      dbFieldNames: columnNames,
      returningDbFieldNames: returningNames,
    });

    this.logger.debug('updateFromSelect SQL:', sql);

    return await this.prismaService
      .txClient()
      .$queryRawUnsafe<Array<{ __id: string; __version: number } & Record<string, unknown>>>(sql);
  }
}
