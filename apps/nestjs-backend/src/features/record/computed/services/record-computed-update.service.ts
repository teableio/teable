import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { match } from 'ts-pattern';
import { InjectDbProvider } from '../../../../db-provider/db.provider';
import { IDbProvider } from '../../../../db-provider/db.provider.interface';
import { retryOnDeadlock } from '../../../../utils/retry-decorator';
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
        const isRollup = f.type === FieldType.Rollup || f.type === FieldType.ConditionalRollup;
        if (hasError && !isLookupStyle && !isRollup) return false;
        // Persist lookup-of-link as well (computed link columns should be stored).
        // We rely on query builder to ensure subquery column types match target columns (e.g., jsonb).
        // Skip formula persisted as generated columns
        return match(f)
          .when(isFormulaField, (f) => !f.getIsPersistedAsGeneratedColumn())
          .with({ type: FieldType.AutoNumber }, () => false)
          .with({ type: FieldType.CreatedTime }, () => isLookupStyle)
          .with({ type: FieldType.LastModifiedTime }, () => isLookupStyle)
          .with({ type: FieldType.CreatedBy }, () => isLookupStyle)
          .with({ type: FieldType.LastModifiedBy }, () => isLookupStyle)
          .otherwise(() => true);
      })
      .map((f) => f.dbFieldName);
  }

  private getReturningColumns(fields: IFieldInstance[]): string[] {
    const isFormulaField = (f: IFieldInstance): f is FormulaFieldDto =>
      f.type === FieldType.Formula;
    const cols: string[] = [];
    for (const f of fields) {
      if (
        !f.isLookup &&
        (f.type === FieldType.CreatedBy ||
          f.type === FieldType.LastModifiedBy ||
          f.type === FieldType.CreatedTime ||
          f.type === FieldType.LastModifiedTime)
      ) {
        continue;
      }
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

  @retryOnDeadlock()
  async updateFromSelect(
    tableId: string,
    qb: Knex.QueryBuilder,
    fields: IFieldInstance[],
    opts?: { restrictRecordIds?: string[]; dbTableName?: string }
  ): Promise<Array<{ __id: string; __version: number } & Record<string, unknown>>> {
    const dbTableName = opts?.dbTableName ?? (await this.getDbTableName(tableId));

    const columnNames = this.getUpdatableColumns(fields);
    const returningNames = this.getReturningColumns(fields);
    if (!columnNames.length) {
      const selectSql = qb.toQuery();
      // No updatable columns (e.g., all are generated formulas). Return current values via SELECT.
      try {
        return await this.prismaService
          .txClient()
          .$queryRawUnsafe<
            Array<{ __id: string; __version: number } & Record<string, unknown>>
          >(selectSql);
      } catch (error) {
        this.handleRawQueryError(error, selectSql, tableId, fields);
      }
    }

    const returningWithAutoNumber = Array.from(
      new Set([...returningNames, AUTO_NUMBER_FIELD_NAME])
    );

    const restrictRecordIdsRaw = opts?.restrictRecordIds?.filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    );
    const restrictRecordIds =
      restrictRecordIdsRaw && restrictRecordIdsRaw.length
        ? Array.from(new Set(restrictRecordIdsRaw))
        : undefined;

    const sql = this.dbProvider.updateFromSelectSql({
      dbTableName,
      idFieldName: '__id',
      subQuery: qb,
      dbFieldNames: columnNames,
      returningDbFieldNames: returningWithAutoNumber,
      restrictRecordIds,
    });
    this.logger.debug('updateFromSelect SQL:', sql);
    try {
      return await this.prismaService
        .txClient()
        .$queryRawUnsafe<Array<{ __id: string; __version: number } & Record<string, unknown>>>(sql);
    } catch (error) {
      this.handleRawQueryError(error, sql, tableId, fields);
    }
  }

  private buildFieldDebugSnapshot(fields: IFieldInstance[]): Array<Record<string, unknown>> {
    return fields.map((field) => {
      const f = field as unknown as Record<string, unknown>;
      return {
        id: f.id,
        name: f.name,
        type: f.type,
        dbFieldName: f.dbFieldName,
        dbFieldType: f.dbFieldType,
        isLookup: f.isLookup,
        isConditionalLookup: f.isConditionalLookup,
        isComputed: f.isComputed,
        hasError: f.hasError,
        options: f.options,
      };
    });
  }

  private stringifyFieldDebugSnapshot(snapshot: unknown): string {
    try {
      return JSON.stringify(snapshot);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to stringify field debug snapshot: ${reason}`);
      return '[field debug snapshot: <unserializable>]';
    }
  }

  private handleRawQueryError(
    error: unknown,
    sql: string,
    tableId: string,
    fields: IFieldInstance[]
  ): never {
    const fieldSnapshot = this.buildFieldDebugSnapshot(fields);
    const fieldSnapshotString = this.stringifyFieldDebugSnapshot(fieldSnapshot);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      error.message = `${error.message}\nSQL: ${sql}\nTableId: ${tableId}\nFields: ${fieldSnapshotString}`;
      Object.assign(error, { sql, tableId, fields: fieldSnapshot });
      this.logger.error(
        `updateFromSelect known request error.
        message: ${error.message}.
        SQL: ${sql}.
        Fields: ${fieldSnapshotString}`,
        error.stack ?? undefined
      );
      throw error;
    }
    this.logger.error(
      `updateFromSelect unexpected query error.
      message: ${(error as Error)?.message}.
      SQL: ${sql}.
      tableId: ${tableId}.
      Fields: ${fieldSnapshotString}`,
      (error as Error)?.stack
    );
    if (error instanceof Error) {
      error.message = `${error.message}\nSQL: ${sql}\nTableId: ${tableId}\nFields: ${fieldSnapshotString}`;
      Object.assign(error, { sql, tableId, fields: fieldSnapshot });
    }
    throw error;
  }
}
