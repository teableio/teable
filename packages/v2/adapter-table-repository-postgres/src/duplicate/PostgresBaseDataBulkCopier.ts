import type {
  BaseDataBulkCopyPlan,
  BaseDataBulkCopyProgress,
  BaseDataBulkCopyResult,
  BulkCopyTableInput,
  DomainError,
  IBaseDataBulkCopier,
  IExecutionContext,
} from '@teable/v2-core';
import { domainError } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../record/di/tokens';

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const ROW_ORDER_COLUMN_PREFIX = '__row_';
const FK_COLUMN_PREFIX = '__fk_fld';
const AUTO_NUMBER_COLUMN = '__auto_number';

// Never copied verbatim: auto number and audit columns are regenerated on the
// target (auto number sequencing, creation timestamps), matching the legacy
// host copier.
const SYSTEM_COLUMNS: Record<string, true> = {
  __auto_number: true,
  __created_time: true,
  __last_modified_time: true,
  __last_modified_by: true,
};

type DbTableNameParts = { schema: string | null; tableName: string };

const splitDbTableName = (dbTableName: string): DbTableNameParts => {
  const dotIndex = dbTableName.indexOf('.');
  if (dotIndex === -1) {
    return { schema: null, tableName: dbTableName };
  }
  return { schema: dbTableName.slice(0, dotIndex), tableName: dbTableName.slice(dotIndex + 1) };
};

const qualifiedTableName = (dbTableName: string): string => {
  const { schema, tableName } = splitDbTableName(dbTableName);
  return schema
    ? `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}`
    : quoteIdentifier(tableName);
};

type ForeignKeyRow = {
  constraint_name: string;
  column_name: string;
  referenced_table_schema: string;
  referenced_table_name: string;
  referenced_column_name: string;
  delete_rule: string;
};

type PlannedForeignKey = ForeignKeyRow & { dbTableName: string };

/**
 * Same-database physical base copier. Rows, link storage columns and junction
 * tables are cloned verbatim with INSERT…SELECT inside one transaction; the
 * foreign keys of every source and target table are dropped first and rebuilt
 * afterwards with their original ON DELETE action so bulk inserts never pay
 * per-row FK checks.
 *
 * The FK introspection anchors on pg_constraint.conrelid (the exact
 * constrained table): constraint names are unique per table, not per schema,
 * so information_schema joins on (constraint_name, table_schema) fan out
 * whenever two tables in one schema hold a same-named FK (e.g. v2's
 * `fk_{column}` naming) — the drop phase then issued the same DROP CONSTRAINT
 * twice and died with PG 42704 (T6990). Teable FKs are single-column, so
 * conkey[1]/confkey[1] keep the one-row-per-constraint contract.
 */
@injectable()
export class PostgresBaseDataBulkCopier implements IBaseDataBulkCopier {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  async isSupported(
    _context: IExecutionContext,
    plan: BaseDataBulkCopyPlan
  ): Promise<Result<boolean, DomainError>> {
    try {
      const sourceSchemas = [
        ...new Set(
          plan.tables.map((table) => splitDbTableName(table.sourceDbTableName).schema ?? 'public')
        ),
      ];
      for (const schema of sourceSchemas) {
        const result = await sql<{ exists: boolean }>`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.schemata WHERE schema_name = ${schema}
          ) AS "exists"
        `.execute(this.db);
        if (!result.rows[0]?.exists) {
          return ok(false);
        }
      }
      return ok(true);
    } catch (error) {
      return err(
        domainError.fromUnknown(error, { code: 'duplicate_base.bulk_copy_preflight_failed' })
      );
    }
  }

  async copyBaseData(
    _context: IExecutionContext,
    plan: BaseDataBulkCopyPlan,
    onProgress?: (progress: BaseDataBulkCopyProgress) => void
  ): Promise<Result<BaseDataBulkCopyResult, DomainError>> {
    try {
      const recordsLength = await this.db.transaction().execute(async (trx) => {
        const dbTableNames = plan.tables.flatMap((table) => [
          table.sourceDbTableName,
          table.targetDbTableName,
        ]);

        const foreignKeys: PlannedForeignKey[] = [];
        for (const dbTableName of dbTableNames) {
          for (const row of await this.listForeignKeys(trx, dbTableName)) {
            foreignKeys.push({ ...row, dbTableName });
          }
        }
        for (const foreignKey of foreignKeys) {
          await sql
            .raw(
              `ALTER TABLE ${qualifiedTableName(foreignKey.dbTableName)} DROP CONSTRAINT ${quoteIdentifier(foreignKey.constraint_name)}`
            )
            .execute(trx);
        }

        let totalRows = 0;
        for (const table of plan.tables) {
          totalRows += await this.countRows(trx, table.sourceDbTableName);
        }
        onProgress?.({ phase: 'table_data_start', processedRows: 0, totalRows });

        const progressState = { processedRows: 0, currentBatch: 0 };
        for (const table of plan.tables) {
          await this.copyTable(trx, plan, table, totalRows, progressState, onProgress);
        }

        for (const junction of plan.junctions) {
          await sql
            .raw(
              `INSERT INTO ${qualifiedTableName(junction.targetJunctionDbTableName)} (${quoteIdentifier(junction.targetSelfKeyName)}, ${quoteIdentifier(junction.targetForeignKeyName)}) SELECT ${quoteIdentifier(junction.sourceSelfKeyName)}, ${quoteIdentifier(junction.sourceForeignKeyName)} FROM ${qualifiedTableName(junction.sourceJunctionDbTableName)}`
            )
            .execute(trx);
        }

        for (const foreignKey of foreignKeys) {
          const referenced = `${quoteIdentifier(foreignKey.referenced_table_schema)}.${quoteIdentifier(foreignKey.referenced_table_name)}`;
          await sql
            .raw(
              `ALTER TABLE ${qualifiedTableName(foreignKey.dbTableName)} ADD CONSTRAINT ${quoteIdentifier(foreignKey.constraint_name)} FOREIGN KEY (${quoteIdentifier(foreignKey.column_name)}) REFERENCES ${referenced} (${quoteIdentifier(foreignKey.referenced_column_name)}) ON DELETE ${foreignKey.delete_rule}`
            )
            .execute(trx);
        }

        onProgress?.({
          phase: 'table_data_done',
          processedRows: totalRows,
          totalRows,
        });
        return totalRows;
      });
      return ok({ recordsLength });
    } catch (error) {
      return err(domainError.fromUnknown(error, { code: 'duplicate_base.bulk_copy_failed' }));
    }
  }

  private async listForeignKeys(
    trx: Transaction<V1TeableDatabase>,
    dbTableName: string
  ): Promise<ForeignKeyRow[]> {
    const { schema, tableName } = splitDbTableName(dbTableName);
    const result = await sql<ForeignKeyRow>`
      SELECT con.conname    AS constraint_name,
             src_att.attname AS column_name,
             ref_nsp.nspname AS referenced_table_schema,
             ref_rel.relname AS referenced_table_name,
             ref_att.attname AS referenced_column_name,
             CASE con.confdeltype
               WHEN 'a' THEN 'NO ACTION'
               WHEN 'r' THEN 'RESTRICT'
               WHEN 'c' THEN 'CASCADE'
               WHEN 'n' THEN 'SET NULL'
               WHEN 'd' THEN 'SET DEFAULT'
             END AS delete_rule
      FROM pg_constraint con
           JOIN pg_class src_rel ON src_rel.oid = con.conrelid
           JOIN pg_namespace src_nsp ON src_nsp.oid = src_rel.relnamespace
           JOIN pg_attribute src_att
                ON src_att.attrelid = con.conrelid AND src_att.attnum = con.conkey[1]
           JOIN pg_class ref_rel ON ref_rel.oid = con.confrelid
           JOIN pg_namespace ref_nsp ON ref_nsp.oid = ref_rel.relnamespace
           JOIN pg_attribute ref_att
                ON ref_att.attrelid = con.confrelid AND ref_att.attnum = con.confkey[1]
      WHERE con.contype = 'f'
        AND src_nsp.nspname = ${schema ?? 'public'}
        AND src_rel.relname = ${tableName}
    `.execute(trx);
    return result.rows;
  }

  private async listColumns(
    trx: Transaction<V1TeableDatabase>,
    dbTableName: string
  ): Promise<ReadonlyArray<string>> {
    const { schema, tableName } = splitDbTableName(dbTableName);
    const result = await sql<{ name: string }>`
      SELECT column_name AS name
      FROM information_schema.columns
      WHERE table_schema = ${schema ?? 'public'} AND table_name = ${tableName}
    `.execute(trx);
    return result.rows.map((row) => row.name);
  }

  private async columnExists(
    trx: Transaction<V1TeableDatabase>,
    dbTableName: string,
    columnName: string
  ): Promise<boolean> {
    const { schema, tableName } = splitDbTableName(dbTableName);
    const result = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = ${schema ?? 'public'}
          AND table_name = ${tableName}
          AND column_name = ${columnName}
      ) AS "exists"
    `.execute(trx);
    return Boolean(result.rows[0]?.exists);
  }

  private async countRows(
    trx: Transaction<V1TeableDatabase>,
    dbTableName: string
  ): Promise<number> {
    const result = await sql<{ count: string }>`
      SELECT COUNT(*) AS count FROM ${sql.raw(qualifiedTableName(dbTableName))}
    `.execute(trx);
    return Number(result.rows[0]?.count ?? 0);
  }

  private async copyTable(
    trx: Transaction<V1TeableDatabase>,
    plan: BaseDataBulkCopyPlan,
    table: BulkCopyTableInput,
    totalRows: number,
    progressState: { processedRows: number; currentBatch: number },
    onProgress?: (progress: BaseDataBulkCopyProgress) => void
  ): Promise<void> {
    const sourceColumns = await this.listColumns(trx, table.sourceDbTableName);
    const targetColumns = await this.listColumns(trx, table.targetDbTableName);

    // Legacy allow-list: when the table has cross-base/disconnected link value
    // columns, only their self keys are considered for __row_*/__fk_* copying.
    const linkSelfKeyNames = table.linkValueColumns
      .map((column) => column.selfKeyName)
      .filter((selfKeyName) => selfKeyName && selfKeyName !== '__id');
    const linkColumnScope =
      table.linkValueColumns.length === 0
        ? sourceColumns
        : sourceColumns.filter((name) => linkSelfKeyNames.includes(name));

    const titleDowngradeByColumn = new Map(
      table.linkValueColumns.map((column) => [column.dbFieldName, column.isMultipleCellValue])
    );

    const excludedTargetColumns = new Set(table.excludedTargetColumns);
    const copyableFieldColumns = targetColumns.filter(
      (name) =>
        !name.startsWith(ROW_ORDER_COLUMN_PREFIX) &&
        !name.startsWith(FK_COLUMN_PREFIX) &&
        !excludedTargetColumns.has(name) &&
        sourceColumns.includes(name)
    );

    const oldRowColumns = linkColumnScope.filter((name) =>
      name.startsWith(ROW_ORDER_COLUMN_PREFIX)
    );
    const newRowColumns = oldRowColumns.map((name) => {
      const sourceViewId = name.slice(ROW_ORDER_COLUMN_PREFIX.length);
      const targetViewId = plan.viewIdMap[sourceViewId];
      return targetViewId ? `${ROW_ORDER_COLUMN_PREFIX}${targetViewId}` : name;
    });

    const oldFkColumns = linkColumnScope.filter((name) => name.startsWith(FK_COLUMN_PREFIX));
    const newFkColumns = oldFkColumns.map((name) => {
      const sourceFieldId = name.slice('__fk_'.length);
      const targetFieldId = plan.fieldIdMap[sourceFieldId];
      return targetFieldId ? `__fk_${targetFieldId}` : name;
    });

    for (const name of newRowColumns) {
      await this.ensureRowOrderColumn(trx, table.targetDbTableName, name);
    }
    for (const name of newFkColumns) {
      await this.ensureFkColumn(trx, table.targetDbTableName, name);
    }

    const finalExcludes = new Set([...Object.keys(SYSTEM_COLUMNS), ...excludedTargetColumns]);
    const oldColumns = copyableFieldColumns
      .concat(oldRowColumns)
      .concat(oldFkColumns)
      .filter((name) => !finalExcludes.has(name));
    const newColumns = copyableFieldColumns
      .concat(newRowColumns)
      .concat(newFkColumns)
      .filter((name) => !finalExcludes.has(name));

    const tableRowCount = await this.countRows(trx, table.sourceDbTableName);
    if (!onProgress || tableRowCount === 0 || oldColumns.length === 0) {
      if (oldColumns.length > 0) {
        await this.executeCopy(trx, table, newColumns, oldColumns, titleDowngradeByColumn);
      }
      progressState.processedRows += tableRowCount;
      return;
    }

    let lastAutoNumber = 0;
    let copiedRows = 0;
    while (copiedRows < tableRowCount) {
      const batch = await sql<{ autoNumber: number | string }>`
        SELECT ${sql.raw(quoteIdentifier(AUTO_NUMBER_COLUMN))} AS "autoNumber"
        FROM ${sql.raw(qualifiedTableName(table.sourceDbTableName))}
        WHERE ${sql.raw(quoteIdentifier(AUTO_NUMBER_COLUMN))} > ${lastAutoNumber}
        ORDER BY ${sql.raw(quoteIdentifier(AUTO_NUMBER_COLUMN))} ASC
        LIMIT ${plan.batchSize}
      `.execute(trx);
      if (batch.rows.length === 0) break;

      const batchLastAutoNumber = Number(batch.rows[batch.rows.length - 1]!.autoNumber);
      await this.executeCopy(trx, table, newColumns, oldColumns, titleDowngradeByColumn, {
        minAutoNumberExclusive: lastAutoNumber,
        maxAutoNumberInclusive: batchLastAutoNumber,
      });

      copiedRows += batch.rows.length;
      progressState.processedRows += batch.rows.length;
      progressState.currentBatch += 1;
      onProgress({
        phase: 'table_data_progress',
        tableId: table.targetTableId,
        tableName: table.targetTableName,
        processedRows: progressState.processedRows,
        batchProcessedRows: batch.rows.length,
        currentBatch: progressState.currentBatch,
        totalRows,
      });
      lastAutoNumber = batchLastAutoNumber;
    }
  }

  private async ensureRowOrderColumn(
    trx: Transaction<V1TeableDatabase>,
    dbTableName: string,
    columnName: string
  ): Promise<void> {
    if (!(await this.columnExists(trx, dbTableName, columnName))) {
      await sql
        .raw(
          `ALTER TABLE ${qualifiedTableName(dbTableName)} ADD COLUMN ${quoteIdentifier(columnName)} double precision`
        )
        .execute(trx);
    }
    await sql
      .raw(
        `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_${columnName}`)} ON ${qualifiedTableName(dbTableName)} (${quoteIdentifier(columnName)})`
      )
      .execute(trx);
  }

  private async ensureFkColumn(
    trx: Transaction<V1TeableDatabase>,
    dbTableName: string,
    columnName: string
  ): Promise<void> {
    if (!(await this.columnExists(trx, dbTableName, columnName))) {
      await sql
        .raw(
          `ALTER TABLE ${qualifiedTableName(dbTableName)} ADD COLUMN ${quoteIdentifier(columnName)} text`
        )
        .execute(trx);
    }
  }

  private async executeCopy(
    trx: Transaction<V1TeableDatabase>,
    table: BulkCopyTableInput,
    newColumns: ReadonlyArray<string>,
    oldColumns: ReadonlyArray<string>,
    titleDowngradeByColumn: ReadonlyMap<string, boolean>,
    range?: { minAutoNumberExclusive?: number; maxAutoNumberInclusive?: number }
  ): Promise<void> {
    const newColumnList = newColumns.map(quoteIdentifier).join(', ');
    const oldColumnList = oldColumns
      .map((column) => {
        if (column === '__version') {
          return '1 AS "__version"';
        }
        const isMultipleCellValue = titleDowngradeByColumn.get(column);
        if (isMultipleCellValue === undefined) {
          return quoteIdentifier(column);
        }
        // Cross-base/disconnected links were downgraded to text fields on the
        // target: their json cell values degrade to the linked record title.
        if (!isMultipleCellValue) {
          return `${quoteIdentifier(column)} ->> 'title' AS ${quoteIdentifier(column)}`;
        }
        return `CASE
          WHEN ${quoteIdentifier(column)} IS NULL THEN NULL
          ELSE (SELECT string_agg(elem ->> 'title', ', ')
                FROM json_array_elements(CAST(${quoteIdentifier(column)} AS json)) AS elem)
        END AS ${quoteIdentifier(column)}`;
      })
      .join(', ');

    const whereClauses: string[] = [];
    if (range?.minAutoNumberExclusive != null) {
      whereClauses.push(
        `${quoteIdentifier(AUTO_NUMBER_COLUMN)} > ${Number(range.minAutoNumberExclusive)}`
      );
    }
    if (range?.maxAutoNumberInclusive != null) {
      whereClauses.push(
        `${quoteIdentifier(AUTO_NUMBER_COLUMN)} <= ${Number(range.maxAutoNumberInclusive)}`
      );
    }
    const whereSql = whereClauses.length ? ` WHERE ${whereClauses.join(' AND ')}` : '';

    await sql
      .raw(
        `INSERT INTO ${qualifiedTableName(table.targetDbTableName)} (${newColumnList}) SELECT ${oldColumnList} FROM ${qualifiedTableName(table.sourceDbTableName)}${whereSql} ORDER BY ${quoteIdentifier(AUTO_NUMBER_COLUMN)}`
      )
      .execute(trx);
  }
}
