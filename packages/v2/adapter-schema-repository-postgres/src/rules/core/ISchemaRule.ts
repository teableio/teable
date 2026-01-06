import type { DomainError } from '@teable/v2-core';
import type { CompiledQuery, QueryExecutorProvider } from 'kysely';
import type { Result } from 'neverthrow';

import type { SchemaRuleContext } from '../context/SchemaRuleContext';

/**
 * Represents a compiled SQL statement that can be executed against the database.
 * This is the same type used in the existing visitors.
 */
export type TableSchemaStatementBuilder = {
  compile: (executorProvider: QueryExecutorProvider) => CompiledQuery;
};

/**
 * Result of validating a schema rule against the current database state.
 */
export type SchemaRuleValidationResult = {
  /** Whether the rule is satisfied in the current database state */
  valid: boolean;
  /** Descriptions of missing schema objects (columns, indexes, etc.) */
  missing?: ReadonlyArray<string>;
  /** Descriptions of extra/unexpected schema objects */
  extra?: ReadonlyArray<string>;
};

/**
 * Represents an atomic schema rule that can be applied, reverted, or validated.
 *
 * Each rule represents a single schema capability (e.g., "has a column", "has an index").
 * Rules can depend on other rules (e.g., an index rule depends on its column existing).
 *
 * Rules are designed to be composed together to form the complete schema requirements
 * for a field or table.
 */
export interface ISchemaRule {
  /**
   * Unique identifier for this rule instance.
   * Used for dependency references and deduplication.
   * Format: `<rule-type>:<field-id>[:<qualifier>]`
   * Examples: "column:fldXxx", "index:fldXxx:fk_column"
   */
  readonly id: string;

  /**
   * Human-readable description of what this rule validates.
   * This is displayed in the UI to explain the rule's purpose.
   * Should be specific enough to help users understand what the rule checks.
   * Examples:
   * - "Physical column 'Name' (text, NOT NULL)"
   * - "Junction table for many-to-many relationship"
   * - "Foreign key column storing link references"
   */
  readonly description: string;

  /**
   * IDs of other rules that must be applied before this rule.
   * The resolver uses this to determine execution order.
   */
  readonly dependencies: ReadonlyArray<string>;

  /**
   * Whether this rule is required (true) or optional (false).
   * Optional rules are only applied when explicitly enabled by configuration.
   */
  readonly required: boolean;

  /**
   * Validates whether the current database state satisfies this rule.
   * Queries information_schema to check for columns, indexes, constraints, etc.
   *
   * @param ctx - The rule execution context containing database connection and field info
   * @returns Validation result indicating whether the rule is satisfied
   */
  isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>>;

  /**
   * Generates SQL statements to apply this rule (create column, add index, etc.).
   *
   * @param ctx - The rule execution context
   * @returns SQL statements to execute, or error if generation fails
   */
  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>;

  /**
   * Generates SQL statements to revert this rule (drop column, remove index, etc.).
   *
   * @param ctx - The rule execution context
   * @returns SQL statements to execute, or error if generation fails
   */
  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>;
}
