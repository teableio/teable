import { sql } from 'kysely';

import type { TableSchemaStatementBuilder } from '../core/ISchemaRule';

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

export const metaStatement = (
  statement: TableSchemaStatementBuilder
): TableSchemaStatementBuilder => ({
  scope: 'meta',
  compile: (executorProvider) => statement.compile(executorProvider),
});

/**
 * Builds a qualified table reference for SQL statements.
 */
export const buildTableIdentifier = (target: TableIdentifier) => {
  if (!target.schema) return sql.ref(target.tableName);
  return sql`${sql.ref(target.schema)}.${sql.ref(target.tableName)}`;
};

/** Compress multi-line SQL into single line for cleaner logs */
export const compressSql = (sqlStr: string): string => sqlStr.replace(/\s+/g, ' ').trim();

/**
 * Creates a DROP COLUMN statement.
 */
export const dropColumnStatement = (
  target: TableIdentifier,
  columnName: string
): TableSchemaStatementBuilder =>
  sql`alter table ${buildTableIdentifier(target)} drop column if exists ${sql.ref(columnName)} cascade`;

/**
 * Creates a DROP TABLE statement.
 */
export const dropTableStatement = (target: TableIdentifier): TableSchemaStatementBuilder =>
  sql`drop table if exists ${buildTableIdentifier(target)} cascade`;

/**
 * Creates a DROP INDEX statement.
 */
export const dropIndexStatement = (
  target: TableIdentifier,
  indexName: string
): TableSchemaStatementBuilder => {
  if (!target.schema) {
    return sql`drop index if exists ${sql.ref(indexName)}`;
  }
  return sql`drop index if exists ${sql.ref(target.schema)}.${sql.ref(indexName)}`;
};

/**
 * Creates a DROP CONSTRAINT statement.
 */
export const dropConstraintStatement = (
  target: TableIdentifier,
  constraintName: string
): TableSchemaStatementBuilder =>
  sql`alter table if exists ${buildTableIdentifier(target)} drop constraint if exists ${sql.ref(constraintName)}`;

/**
 * Creates a CREATE INDEX statement.
 */
export const createIndexStatement = (
  target: TableIdentifier,
  indexName: string,
  columnName: string
): TableSchemaStatementBuilder =>
  sql`create index if not exists ${sql.ref(indexName)} on ${buildTableIdentifier(target)} (${sql.ref(columnName)})`;

/**
 * Creates a CREATE UNIQUE INDEX statement.
 */
export const createUniqueIndexStatement = (
  target: TableIdentifier,
  indexName: string,
  columnName: string
): TableSchemaStatementBuilder =>
  sql`create unique index if not exists ${sql.ref(indexName)} on ${buildTableIdentifier(target)} (${sql.ref(columnName)})`;

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
  onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' = 'CASCADE'
): TableSchemaStatementBuilder => {
  const sourceTableFull = sourceTable.schema
    ? `"${sourceTable.schema}"."${sourceTable.tableName}"`
    : `"${sourceTable.tableName}"`;
  const targetTableFull = targetTable.schema
    ? `"${targetTable.schema}"."${targetTable.tableName}"`
    : `"${targetTable.tableName}"`;
  const targetSchema = targetTable.schema ?? 'public';

  return sql.raw(
    compressSql(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = '${targetSchema}' 
          AND table_name = '${targetTable.tableName}'
        ) THEN
          BEGIN
            ALTER TABLE ${sourceTableFull} 
            ADD CONSTRAINT "${constraintName}" 
            FOREIGN KEY ("${columnName}") 
            REFERENCES ${targetTableFull} ("${targetColumn}") 
            ON DELETE ${onDelete};
          EXCEPTION WHEN duplicate_object THEN
            NULL;
          END;
        END IF;
      END
      $$;
    `)
  );
};

/**
 * Creates a FK constraint statement that resolves the target physical table from table_meta.
 * This is needed for legacy/custom db_table_name values that do not match logical table ids.
 */
export const createForeignKeyConstraintStatementFromTableMeta = (
  sourceTable: TableIdentifier,
  constraintName: string,
  columnName: string,
  targetTableMetaId: string,
  targetColumn: string,
  onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' = 'CASCADE',
  fallbackTargetTable?: TableIdentifier
): TableSchemaStatementBuilder => {
  const sourceTableFull = quoteTableIdentifier(sourceTable);
  const fallbackTargetSchema = fallbackTargetTable?.schema ?? 'public';
  const fallbackTargetName = fallbackTargetTable?.tableName ?? '';

  return sql.raw(
    compressSql(`
      DO $$
      DECLARE
        target_tbl text;
        target_schema text;
        target_name text;
      BEGIN
        IF to_regclass('public.table_meta') IS NULL THEN
          target_schema := ${quoteLiteral(fallbackTargetSchema)};
          target_name := ${quoteLiteral(fallbackTargetName)};
        ELSE
          SELECT db_table_name INTO target_tbl
          FROM table_meta
          WHERE id = ${quoteLiteral(targetTableMetaId)} AND deleted_time IS NULL
          LIMIT 1;

          IF target_tbl IS NULL THEN
            target_schema := ${quoteLiteral(fallbackTargetSchema)};
            target_name := ${quoteLiteral(fallbackTargetName)};
          ELSIF strpos(target_tbl, '.') > 0 THEN
            target_schema := split_part(target_tbl, '.', 1);
            target_name := split_part(target_tbl, '.', 2);
          ELSE
            target_schema := 'public';
            target_name := target_tbl;
          END IF;
        END IF;

        IF target_name IS NULL OR target_name = '' THEN
          RETURN;
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = target_schema
            AND table_name = target_name
        ) THEN
          BEGIN
            EXECUTE format(
              'ALTER TABLE ${sourceTableFull} ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I.%I (%I) ON DELETE ${onDelete}',
              ${quoteLiteral(constraintName)},
              ${quoteLiteral(columnName)},
              target_schema,
              target_name,
              ${quoteLiteral(targetColumn)}
            );
          EXCEPTION WHEN duplicate_object THEN
            NULL;
          END;
        END IF;
      END
      $$;
    `)
  );
};

/**
 * Creates an ADD GENERATED COLUMN statement.
 */
export const addGeneratedColumnStatement = (
  target: TableIdentifier,
  columnName: string,
  definition: ReturnType<typeof sql>
): TableSchemaStatementBuilder =>
  sql`alter table ${buildTableIdentifier(target)} add column if not exists ${sql.ref(
    columnName
  )} ${definition}`;

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

  return sql.raw(
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

  return sql.raw(
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
  );
};

export const backfillJunctionTableFromLinkValueStatement = (params: {
  sourceTable: TableIdentifier;
  sourceTableId?: string;
  sourceLinkValueColumnName: string;
  junctionTable: TableIdentifier;
  selfKeyName: string;
  foreignKeyName: string;
  orderColumnName?: string;
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

  return sql.raw(
    compressSql(`
      DO $$
      DECLARE
        same_db_field_count integer := 0;
        has_field_deleted_time boolean := false;
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = ${quoteLiteral(sourceSchemaName)}
            AND table_name = ${quoteLiteral(sourceTableName)}
            AND column_name = ${quoteLiteral(params.sourceLinkValueColumnName)}
        ) THEN
          IF ${params.sourceTableId ? 'TRUE' : 'FALSE'} AND EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'field'
              AND column_name = 'db_field_name'
          ) THEN
            SELECT EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'field'
                AND column_name = 'deleted_time'
            ) INTO has_field_deleted_time;

            IF has_field_deleted_time THEN
              EXECUTE 'SELECT count(*) FROM field WHERE table_id = $1 AND db_field_name = $2 AND deleted_time IS NULL'
              INTO same_db_field_count
              USING ${quoteLiteral(params.sourceTableId ?? '')}, ${quoteLiteral(params.sourceLinkValueColumnName)};
            ELSE
              EXECUTE 'SELECT count(*) FROM field WHERE table_id = $1 AND db_field_name = $2'
              INTO same_db_field_count
              USING ${quoteLiteral(params.sourceTableId ?? '')}, ${quoteLiteral(params.sourceLinkValueColumnName)};
            END IF;

            IF same_db_field_count > 1 THEN
              RETURN;
            END IF;
          END IF;

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
  );
};
