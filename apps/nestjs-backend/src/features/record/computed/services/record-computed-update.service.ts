import { Injectable, Logger } from '@nestjs/common';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { Knex } from 'knex';
import { match } from 'ts-pattern';
import { InjectDbProvider } from '../../../../db-provider/db.provider';
import { IDbProvider } from '../../../../db-provider/db.provider.interface';
import { AUTO_NUMBER_FIELD_NAME } from '../../../field/constant';
import type { IFieldInstance } from '../../../field/model/factory';
import type { FormulaFieldDto } from '../../../field/model/field-dto/formula-field.dto';

@Injectable()
export class RecordComputedUpdateService {
  private logger = new Logger(RecordComputedUpdateService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
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
        // Skip fields currently in error state to avoid type/cast issues — except for
        // lookup/rollup (and lookup-of-link) which we still want to persist so they
        // get nulled out after their source is deleted. Query builder emits a typed
        // NULL for errored lookups/rollups ensuring safe assignment.
        const hasError = (f as unknown as { hasError?: boolean }).hasError;
        const isLookupStyle = (f as unknown as { isLookup?: boolean }).isLookup === true;
        const isRollup = f.type === FieldType.Rollup || f.type === FieldType.ReferenceLookup;
        if (hasError && !isLookupStyle && !isRollup) return false;
        // Persist lookup-of-link as well (computed link columns should be stored).
        // We rely on query builder to ensure subquery column types match target columns (e.g., jsonb).
        // Skip formula persisted as generated columns
        return match(f)
          .when(isFormulaField, (f) => !f.getIsPersistedAsGeneratedColumn())
          .with(
            { type: FieldType.AutoNumber },
            { type: FieldType.CreatedTime },
            { type: FieldType.LastModifiedTime },
            { type: FieldType.CreatedBy },
            { type: FieldType.LastModifiedBy },
            () => false
          )
          .otherwise(() => true);
      })
      .map((f) => f.dbFieldName);
  }

  private getReturningColumns(fields: IFieldInstance[]): string[] {
    const isFormulaField = (f: IFieldInstance): f is FormulaFieldDto =>
      f.type === FieldType.Formula;
    const cols: string[] = [];
    for (const f of fields) {
      if (isFormulaField(f)) {
        // Lookup-formula fields are persisted as regular columns on the host table
        // and must be included in the RETURNING list by their dbFieldName.
        if (f.isLookup) {
          cols.push(f.dbFieldName);
          continue;
        }
        // Non-lookup formulas: include generated column when persisted and not errored
        if (f.getIsPersistedAsGeneratedColumn() && !f.hasError) {
          cols.push(f.getGeneratedColumnName());
          continue;
        }
        // Formulas persisted as regular columns still need to be returned via dbFieldName
        cols.push(f.dbFieldName);
        continue;
      }
      // Non-formula fields (including lookup/rollup) return by their physical column name
      cols.push(f.dbFieldName);
    }
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

    const returningWithAutoNumber = Array.from(
      new Set([...returningNames, AUTO_NUMBER_FIELD_NAME])
    );

    const sql = this.dbProvider.updateFromSelectSql({
      dbTableName,
      idFieldName: '__id',
      subQuery: qb,
      dbFieldNames: columnNames,
      returningDbFieldNames: returningWithAutoNumber,
    });
    this.logger.debug('updateFromSelect SQL:', sql);

    return await this.prismaService
      .txClient()
      .$queryRawUnsafe<Array<{ __id: string; __version: number } & Record<string, unknown>>>(sql);
  }
}
