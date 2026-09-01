import { sql } from 'kysely';

import { baseRecordColumnNames } from '../../naming';
import type {
  TableSchemaStatementBuilder,
  TableSchemaStatementCompiler,
  TableSchemaStatementScope,
} from '../core/ISchemaRule';

/**
 * Represents a table in the database with optional schema.
 */
export type TableIdentifier = {
  schema: string | null;
  tableName: string;
};

export const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;
export const quoteLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export const quoteTableIdentifier = (target: TableIdentifier): string =>
  target.schema
    ? `${quoteIdentifier(target.schema)}.${quoteIdentifier(target.tableName)}`
    : quoteIdentifier(target.tableName);

const scopedStatement = (
  scope: TableSchemaStatementScope,
  statement: TableSchemaStatementCompiler
): TableSchemaStatementBuilder => ({
  scope,
  compile: (executorProvider) => statement.compile(executorProvider),
});

export const dataStatement = (
  statement: TableSchemaStatementCompiler
): TableSchemaStatementBuilder => scopedStatement('data', statement);

export const metaStatement = (
  statement: TableSchemaStatementCompiler
): TableSchemaStatementBuilder => scopedStatement('meta', statement);

/**
 * Builds a qualified table reference for SQL statements.
 */
export const buildTableIdentifier = (target: TableIdentifier) => {
  if (!target.schema) return sql.ref(target.tableName);
  return sql`${sql.ref(target.schema)}.${sql.ref(target.tableName)}`;
};

/** Compress multi-line SQL into single line for cleaner logs */
export const compressSql = (sqlStr: string): string => sqlStr.replace(/\s+/g, ' ').trim();

export const parseDbTableName = (dbTableName: string): TableIdentifier => {
  const separatorIndex = dbTableName.indexOf('.');
  if (separatorIndex < 0) {
    return { schema: 'public', tableName: dbTableName };
  }
  return {
    schema: dbTableName.slice(0, separatorIndex),
    tableName: dbTableName.slice(separatorIndex + 1),
  };
};

export const resolveTableIdentifierFromMeta = async (
  metaDb: Parameters<NonNullable<TableSchemaStatementBuilder['execute']>>[0]['metaDb'],
  targetTableMetaId: string
): Promise<TableIdentifier | undefined> => {
  const tableMetaExists = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'table_meta'
    ) AS exists
  `.execute(metaDb);
  if (!tableMetaExists.rows[0]?.exists) {
    return undefined;
  }

  const result = await sql<{ db_table_name: string | null }>`
    SELECT db_table_name
    FROM table_meta
    WHERE id = ${targetTableMetaId}
      AND deleted_time IS NULL
    LIMIT 1
  `.execute(metaDb);

  const dbTableName = result.rows[0]?.db_table_name;
  if (!dbTableName) {
    return undefined;
  }
  return parseDbTableName(dbTableName);
};

const buildAddForeignKeySql = (params: {
  sourceSchema: string;
  sourceTableName: string;
  constraintName: string;
  columnName: string;
  targetSchema: string;
  targetTableName: string;
  targetColumn: string;
  onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT';
}): string =>
  compressSql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = ${quoteLiteral(params.targetSchema)}
          AND table_name = ${quoteLiteral(params.targetTableName)}
      ) THEN
        BEGIN
          EXECUTE format(
            'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I.%I (%I) ON DELETE ${params.onDelete}',
            ${quoteLiteral(params.sourceSchema)},
            ${quoteLiteral(params.sourceTableName)},
            ${quoteLiteral(params.constraintName)},
            ${quoteLiteral(params.columnName)},
            ${quoteLiteral(params.targetSchema)},
            ${quoteLiteral(params.targetTableName)},
            ${quoteLiteral(params.targetColumn)}
          );
        EXCEPTION WHEN duplicate_object THEN
          NULL;
        END;
      END IF;
    END
    $$;
  `);

/**
 * Creates a DROP COLUMN statement.
 *
 * Refuses system record columns (__id, __version, ...) unless explicitly allowed:
 * a rule mistakenly constructed with a system column name would otherwise silently
 * destroy record data when its down() runs (T6807). Only rules that genuinely own
 * system columns (SystemColumnExistsRule) may opt in via `allowSystemColumn`.
 */
export const dropColumnStatement = (
  target: TableIdentifier,
  columnName: string,
  options?: { allowSystemColumn?: boolean }
): TableSchemaStatementBuilder => {
  if (!options?.allowSystemColumn && baseRecordColumnNames.includes(columnName)) {
    throw new Error(
      `Refusing to build DROP COLUMN for system column "${columnName}" on table "${quoteTableIdentifier(
        target
      )}"; pass allowSystemColumn only from a rule that owns system columns`
    );
  }
  return dataStatement(
    sql`alter table if exists ${buildTableIdentifier(target)} drop column if exists ${sql.ref(
      columnName
    )} cascade`
  );
};

/**
 * Creates a DROP TABLE statement.
 */
export const dropTableStatement = (target: TableIdentifier): TableSchemaStatementBuilder =>
  dataStatement(sql`drop table if exists ${buildTableIdentifier(target)} cascade`);

/**
 * Creates a DROP INDEX statement.
 */
export const dropIndexStatement = (
  target: TableIdentifier,
  indexName: string
): TableSchemaStatementBuilder => {
  if (!target.schema) {
    return dataStatement(sql`drop index if exists ${sql.ref(indexName)}`);
  }
  return dataStatement(sql`drop index if exists ${sql.ref(target.schema)}.${sql.ref(indexName)}`);
};

/**
 * Creates a DROP CONSTRAINT statement.
 */
export const dropConstraintStatement = (
  target: TableIdentifier,
  constraintName: string
): TableSchemaStatementBuilder =>
  dataStatement(
    sql`alter table if exists ${buildTableIdentifier(target)} drop constraint if exists ${sql.ref(
      constraintName
    )}`
  );

/**
 * Creates a CREATE INDEX statement.
 */
export const createIndexStatement = (
  target: TableIdentifier,
  indexName: string,
  columnName: string
): TableSchemaStatementBuilder =>
  dataStatement(
    sql`create index if not exists ${sql.ref(indexName)} on ${buildTableIdentifier(
      target
    )} (${sql.ref(columnName)})`
  );

/**
 * Creates a CREATE UNIQUE INDEX statement.
 */
export const createUniqueIndexStatement = (
  target: TableIdentifier,
  indexName: string,
  columnName: string
): TableSchemaStatementBuilder =>
  dataStatement(
    sql`create unique index if not exists ${sql.ref(indexName)} on ${buildTableIdentifier(
      target
    )} (${sql.ref(columnName)})`
  );

/**
 * Creates a FK constraint statement that checks if the target table exists first.
 * Uses a PL/pgSQL DO block to conditionally add the constraint.
 */
export const createForeignKeyConstraintStatement = (
  sourceTable: TableIdentifier,
  constraintName: string,
  columnName: string,
  targetTable: TableIdentifier,
  targetColumn: string,
  onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' = 'CASCADE',
  targetTableMetaId?: string
): TableSchemaStatementBuilder => {
  const sourceSchema = sourceTable.schema ?? 'public';
  const fallbackTargetSchema = targetTable.schema ?? 'public';
  const fallbackTargetTableName = targetTable.tableName;
  const previewSql = buildAddForeignKeySql({
    sourceSchema,
    sourceTableName: sourceTable.tableName,
    constraintName,
    columnName,
    targetSchema: fallbackTargetSchema,
    targetTableName: fallbackTargetTableName,
    targetColumn,
    onDelete,
  });

  if (!targetTableMetaId) {
    return dataStatement(sql.raw(previewSql));
  }

  return {
    scope: 'data',
    compile: (executorProvider) => sql.raw(previewSql).compile(executorProvider),
    execute: async ({ dataDb, metaDb }) => {
      const resolvedTarget = (await resolveTableIdentifierFromMeta(metaDb, targetTableMetaId)) ?? {
        schema: fallbackTargetSchema,
        tableName: fallbackTargetTableName,
      };
      await sql
        .raw(
          buildAddForeignKeySql({
            sourceSchema,
            sourceTableName: sourceTable.tableName,
            constraintName,
            columnName,
            targetSchema: resolvedTarget.schema ?? 'public',
            targetTableName: resolvedTarget.tableName,
            targetColumn,
            onDelete,
          })
        )
        .execute(dataDb);
    },
  };
};

/**
 * Creates an ADD GENERATED COLUMN statement.
 */
export const addGeneratedColumnStatement = (
  target: TableIdentifier,
  columnName: string,
  definition: ReturnType<typeof sql>
): TableSchemaStatementBuilder =>
  dataStatement(
    sql`alter table ${buildTableIdentifier(target)} add column if not exists ${sql.ref(
      columnName
    )} ${definition}`
  );

export const backfillFkColumnFromLinkValueStatement = (
  target: TableIdentifier,
  linkValueColumnName: string,
  fkColumnName: string
): TableSchemaStatementBuilder => {
  const qualifiedTable = quoteTableIdentifier(target);
  const linkValueColumn = quoteIdentifier(linkValueColumnName);
  const fkColumn = quoteIdentifier(fkColumnName);
  const schemaName = target.schema ?? 'public';
  const tableName = target.tableName;

  return dataStatement(
    sql.raw(
      compressSql(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = ${quoteLiteral(schemaName)}
            AND table_name = ${quoteLiteral(tableName)}
            AND column_name = ${quoteLiteral(linkValueColumnName)}
        ) THEN
          UPDATE ${qualifiedTable}
          SET ${fkColumn} = CASE
            WHEN ${linkValueColumn} IS NULL THEN NULL
            WHEN jsonb_typeof(${linkValueColumn}) = 'array' THEN NULLIF(${linkValueColumn}->0->>'id', '')
            ELSE NULLIF(${linkValueColumn}->>'id', '')
          END
          WHERE ${linkValueColumn} IS NOT NULL
            AND ${fkColumn} IS NULL;
        END IF;
      END
      $$;
    `)
    )
  );
};

export const backfillForeignHostFkColumnFromLinkValueStatement = (params: {
  sourceTable: TableIdentifier;
  sourceLinkValueColumnName: string;
  targetTable: TableIdentifier;
  targetFkColumnName: string;
}): TableSchemaStatementBuilder => {
  const sourceTable = quoteTableIdentifier(params.sourceTable);
  const targetTable = quoteTableIdentifier(params.targetTable);
  const sourceLinkValueColumn = quoteIdentifier(params.sourceLinkValueColumnName);
  const targetFkColumn = quoteIdentifier(params.targetFkColumnName);
  const sourceSchemaName = params.sourceTable.schema ?? 'public';
  const sourceTableName = params.sourceTable.tableName;

  return dataStatement(
    sql.raw(
      compressSql(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = ${quoteLiteral(sourceSchemaName)}
            AND table_name = ${quoteLiteral(sourceTableName)}
            AND column_name = ${quoteLiteral(params.sourceLinkValueColumnName)}
        ) THEN
          WITH pairs AS (
            SELECT
              s."__id" AS self_id,
              elem.value->>'id' AS foreign_id
            FROM ${sourceTable} AS s
            CROSS JOIN LATERAL jsonb_array_elements(
              CASE
                WHEN ${sourceLinkValueColumn} IS NULL THEN '[]'::jsonb
                WHEN jsonb_typeof(${sourceLinkValueColumn}) = 'array' THEN ${sourceLinkValueColumn}
                WHEN jsonb_typeof(${sourceLinkValueColumn}) = 'null' THEN '[]'::jsonb
                ELSE jsonb_build_array(${sourceLinkValueColumn})
              END
            ) AS elem(value)
          ),
          dedup AS (
            SELECT foreign_id, MIN(self_id) AS self_id
            FROM pairs
            WHERE foreign_id IS NOT NULL
              AND foreign_id <> ''
            GROUP BY foreign_id
          )
          UPDATE ${targetTable} AS t
          SET ${targetFkColumn} = d.self_id
          FROM dedup d
          WHERE t."__id" = d.foreign_id
            AND t.${targetFkColumn} IS NULL;
        END IF;
      END
      $$;
    `)
    )
  );
};

export const backfillJunctionTableFromLinkValueStatement = (params: {
  sourceTable: TableIdentifier;
  sourceLinkValueColumnName: string;
  junctionTable: TableIdentifier;
  selfKeyName: string;
  foreignKeyName: string;
  orderColumnName?: string;
  skipBackfill?: boolean;
}): TableSchemaStatementBuilder => {
  const sourceTable = quoteTableIdentifier(params.sourceTable);
  const junctionTable = quoteTableIdentifier(params.junctionTable);
  const sourceLinkValueColumn = quoteIdentifier(params.sourceLinkValueColumnName);
  const selfKeyColumn = quoteIdentifier(params.selfKeyName);
  const foreignKeyColumn = quoteIdentifier(params.foreignKeyName);
  const orderColumn = params.orderColumnName ? quoteIdentifier(params.orderColumnName) : undefined;
  const sourceSchemaName = params.sourceTable.schema ?? 'public';
  const sourceTableName = params.sourceTable.tableName;

  const insertColumns = orderColumn
    ? `${selfKeyColumn}, ${foreignKeyColumn}, ${orderColumn}`
    : `${selfKeyColumn}, ${foreignKeyColumn}`;
  const selectColumns = orderColumn
    ? `d.self_id, d.foreign_id, d.order_pos::double precision`
    : `d.self_id, d.foreign_id`;

  return dataStatement(
    sql.raw(
      compressSql(`
      DO $$
      BEGIN
        IF ${params.skipBackfill ? 'TRUE' : 'FALSE'} THEN
          RETURN;
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = ${quoteLiteral(sourceSchemaName)}
            AND table_name = ${quoteLiteral(sourceTableName)}
            AND column_name = ${quoteLiteral(params.sourceLinkValueColumnName)}
        ) THEN
          WITH pairs AS (
            SELECT
              s."__id" AS self_id,
              elem.value->>'id' AS foreign_id,
              elem.ord AS order_pos
            FROM ${sourceTable} AS s
            CROSS JOIN LATERAL jsonb_array_elements(
              CASE
                WHEN ${sourceLinkValueColumn} IS NULL THEN '[]'::jsonb
                WHEN jsonb_typeof(${sourceLinkValueColumn}) = 'array' THEN ${sourceLinkValueColumn}
                WHEN jsonb_typeof(${sourceLinkValueColumn}) = 'null' THEN '[]'::jsonb
                ELSE jsonb_build_array(${sourceLinkValueColumn})
              END
            ) WITH ORDINALITY AS elem(value, ord)
          ),
          dedup AS (
            SELECT self_id, foreign_id, MIN(order_pos) AS order_pos
            FROM pairs
            WHERE foreign_id IS NOT NULL
              AND foreign_id <> ''
            GROUP BY self_id, foreign_id
          )
          INSERT INTO ${junctionTable} (${insertColumns})
          SELECT ${selectColumns}
          FROM dedup d
          WHERE NOT EXISTS (
            SELECT 1
            FROM ${junctionTable} j
            WHERE j.${selfKeyColumn} = d.self_id
              AND j.${foreignKeyColumn} = d.foreign_id
          );
        END IF;
      END
      $$;
    `)
    )
  );
};
