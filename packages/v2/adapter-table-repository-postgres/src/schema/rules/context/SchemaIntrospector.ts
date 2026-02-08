import type { DomainError } from '@teable/v2-core';
import type { Result } from 'neverthrow';

/**
 * Information about a database column retrieved from information_schema.
 */
export interface ColumnInfo {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  isGenerated: boolean;
}

/**
 * Information about a database index.
 */
export interface IndexInfo {
  indexName: string;
  columnNames: ReadonlyArray<string>;
  isUnique: boolean;
}

/**
 * Information about a foreign key constraint.
 */
export interface ForeignKeyInfo {
  constraintName: string;
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
}

/**
 * Information about a table constraint (unique, check, etc.).
 */
export interface ConstraintInfo {
  constraintName: string;
  constraintType: 'UNIQUE' | 'CHECK' | 'PRIMARY KEY' | 'FOREIGN KEY';
  columnNames: ReadonlyArray<string>;
}

/**
 * Interface for introspecting the current database schema state.
 * Used by schema rules to validate whether they are satisfied.
 *
 * This abstraction allows rules to check the database state without
 * coupling to specific SQL dialects or query implementations.
 */
export interface SchemaIntrospector {
  /**
   * Checks whether a column exists in the specified table.
   */
  columnExists(
    schema: string | null,
    table: string,
    column: string
  ): Promise<Result<boolean, DomainError>>;

  /**
   * Gets detailed information about a column, or null if it doesn't exist.
   */
  getColumn(
    schema: string | null,
    table: string,
    column: string
  ): Promise<Result<ColumnInfo | null, DomainError>>;

  /**
   * Checks whether an index exists in the specified schema.
   */
  indexExists(schema: string | null, indexName: string): Promise<Result<boolean, DomainError>>;

  /**
   * Gets detailed information about an index, or null if it doesn't exist.
   */
  getIndex(
    schema: string | null,
    indexName: string
  ): Promise<Result<IndexInfo | null, DomainError>>;

  /**
   * Checks whether a foreign key constraint exists on the specified table.
   */
  foreignKeyExists(
    schema: string | null,
    table: string,
    constraintName: string
  ): Promise<Result<boolean, DomainError>>;

  /**
   * Gets detailed information about a foreign key constraint.
   */
  getForeignKey(
    schema: string | null,
    table: string,
    constraintName: string
  ): Promise<Result<ForeignKeyInfo | null, DomainError>>;

  /**
   * Checks whether a table exists in the specified schema.
   */
  tableExists(schema: string | null, table: string): Promise<Result<boolean, DomainError>>;

  /**
   * Checks whether a unique constraint exists on the specified table.
   */
  constraintExists(
    schema: string | null,
    table: string,
    constraintName: string
  ): Promise<Result<boolean, DomainError>>;
}
