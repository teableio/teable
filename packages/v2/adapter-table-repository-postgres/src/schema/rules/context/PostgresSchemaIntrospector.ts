import { domainError, type DomainError } from '@teable/v2-core';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type {
  ColumnInfo,
  ConstraintInfo,
  ForeignKeyInfo,
  IndexInfo,
  SchemaIntrospector,
} from './SchemaIntrospector';

/**
 * PostgreSQL implementation of SchemaIntrospector.
 * Queries information_schema and pg_catalog to introspect database state.
 */
export class PostgresSchemaIntrospector implements SchemaIntrospector {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly db: Kysely<any>) {}

  async columnExists(
    schema: string | null,
    table: string,
    column: string
  ): Promise<Result<boolean, DomainError>> {
    try {
      const schemaName = schema ?? 'public';
      const result = await sql<{ exists: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = ${schemaName}
          AND table_name = ${table}
          AND column_name = ${column}
        ) as exists
      `.execute(this.db);

      return ok(result.rows[0]?.exists ?? false);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to check column existence: ${error instanceof Error ? error.message : String(error)}`,
          code: 'schema.introspection_failed',
          details: { schema, table, column },
        })
      );
    }
  }

  async getColumn(
    schema: string | null,
    table: string,
    column: string
  ): Promise<Result<ColumnInfo | null, DomainError>> {
    try {
      const schemaName = schema ?? 'public';
      const result = await sql<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        is_generated: string;
      }>`
        SELECT 
          column_name,
          data_type,
          is_nullable,
          is_generated
        FROM information_schema.columns
        WHERE table_schema = ${schemaName}
        AND table_name = ${table}
        AND column_name = ${column}
      `.execute(this.db);

      if (result.rows.length === 0) {
        return ok(null);
      }

      const row = result.rows[0];
      return ok({
        columnName: row.column_name,
        dataType: row.data_type,
        isNullable: row.is_nullable === 'YES',
        isGenerated: row.is_generated !== 'NEVER',
      });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to get column info: ${error instanceof Error ? error.message : String(error)}`,
          code: 'schema.introspection_failed',
          details: { schema, table, column },
        })
      );
    }
  }

  async indexExists(
    schema: string | null,
    indexName: string
  ): Promise<Result<boolean, DomainError>> {
    try {
      const schemaName = schema ?? 'public';
      const result = await sql<{ exists: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = ${schemaName}
          AND indexname = ${indexName}
        ) as exists
      `.execute(this.db);

      return ok(result.rows[0]?.exists ?? false);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to check index existence: ${error instanceof Error ? error.message : String(error)}`,
          code: 'schema.introspection_failed',
          details: { schema, indexName },
        })
      );
    }
  }

  async getIndex(
    schema: string | null,
    indexName: string
  ): Promise<Result<IndexInfo | null, DomainError>> {
    try {
      const schemaName = schema ?? 'public';
      // Query pg_indexes for basic info and pg_index for uniqueness
      const result = await sql<{
        indexname: string;
        indisunique: boolean;
        column_names: string[];
      }>`
        SELECT 
          i.indexname,
          ix.indisunique,
          ARRAY(
            SELECT a.attname
            FROM pg_attribute a
            WHERE a.attrelid = ix.indrelid
            AND a.attnum = ANY(ix.indkey)
            ORDER BY array_position(ix.indkey, a.attnum)
          ) as column_names
        FROM pg_indexes i
        JOIN pg_class c ON c.relname = i.indexname
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = i.schemaname
        JOIN pg_index ix ON ix.indexrelid = c.oid
        WHERE i.schemaname = ${schemaName}
        AND i.indexname = ${indexName}
      `.execute(this.db);

      if (result.rows.length === 0) {
        return ok(null);
      }

      const row = result.rows[0];
      return ok({
        indexName: row.indexname,
        columnNames: row.column_names,
        isUnique: row.indisunique,
      });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to get index info: ${error instanceof Error ? error.message : String(error)}`,
          code: 'schema.introspection_failed',
          details: { schema, indexName },
        })
      );
    }
  }

  async foreignKeyExists(
    schema: string | null,
    table: string,
    constraintName: string
  ): Promise<Result<boolean, DomainError>> {
    try {
      const schemaName = schema ?? 'public';
      const result = await sql<{ exists: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_schema = ${schemaName}
          AND table_name = ${table}
          AND constraint_name = ${constraintName}
          AND constraint_type = 'FOREIGN KEY'
        ) as exists
      `.execute(this.db);

      return ok(result.rows[0]?.exists ?? false);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to check foreign key existence: ${error instanceof Error ? error.message : String(error)}`,
          code: 'schema.introspection_failed',
          details: { schema, table, constraintName },
        })
      );
    }
  }

  async getForeignKey(
    schema: string | null,
    table: string,
    constraintName: string
  ): Promise<Result<ForeignKeyInfo | null, DomainError>> {
    try {
      const schemaName = schema ?? 'public';
      const result = await sql<{
        constraint_name: string;
        column_name: string;
        referenced_table: string;
        referenced_column: string;
      }>`
        SELECT 
          tc.constraint_name,
          kcu.column_name,
          ccu.table_name as referenced_table,
          ccu.column_name as referenced_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.table_schema = ${schemaName}
        AND tc.table_name = ${table}
        AND tc.constraint_name = ${constraintName}
        AND tc.constraint_type = 'FOREIGN KEY'
      `.execute(this.db);

      if (result.rows.length === 0) {
        return ok(null);
      }

      const row = result.rows[0];
      return ok({
        constraintName: row.constraint_name,
        columnName: row.column_name,
        referencedTable: row.referenced_table,
        referencedColumn: row.referenced_column,
      });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to get foreign key info: ${error instanceof Error ? error.message : String(error)}`,
          code: 'schema.introspection_failed',
          details: { schema, table, constraintName },
        })
      );
    }
  }

  async tableExists(schema: string | null, table: string): Promise<Result<boolean, DomainError>> {
    try {
      const schemaName = schema ?? 'public';
      const result = await sql<{ exists: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = ${schemaName}
          AND table_name = ${table}
        ) as exists
      `.execute(this.db);

      return ok(result.rows[0]?.exists ?? false);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to check table existence: ${error instanceof Error ? error.message : String(error)}`,
          code: 'schema.introspection_failed',
          details: { schema, table },
        })
      );
    }
  }

  async constraintExists(
    schema: string | null,
    table: string,
    constraintName: string
  ): Promise<Result<boolean, DomainError>> {
    try {
      const schemaName = schema ?? 'public';
      const result = await sql<{ exists: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_schema = ${schemaName}
          AND table_name = ${table}
          AND constraint_name = ${constraintName}
        ) as exists
      `.execute(this.db);

      return ok(result.rows[0]?.exists ?? false);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to check constraint existence: ${error instanceof Error ? error.message : String(error)}`,
          code: 'schema.introspection_failed',
          details: { schema, table, constraintName },
        })
      );
    }
  }
}

// Export for unused import fix
void (null as unknown as ConstraintInfo);
