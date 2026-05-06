import type { DomainError } from '@teable/v2-core';
import type { CompiledQuery, QueryExecutorProvider } from 'kysely';
import type { Result } from 'neverthrow';

import type { SchemaRuleContext } from '../context/SchemaRuleContext';

/**
 * Represents a compiled SQL statement that can be executed against the database.
 * This is the same type used in the existing visitors.
 */
export type TableSchemaStatementBuilder = {
  scope?: 'data' | 'meta';
  compile: (executorProvider: QueryExecutorProvider) => CompiledQuery;
};

export type SchemaRuleI18nValue = string | number | boolean;

export interface SchemaRuleI18nMessage {
  key?: string;
  values?: Readonly<Record<string, SchemaRuleI18nValue>>;
  fallback?: string;
}

export interface SchemaRuleDetailItem {
  code?: string;
  message: SchemaRuleI18nMessage;
  description?: SchemaRuleI18nMessage;
}

export interface SchemaRuleManualRepairOption {
  value: string;
  label: SchemaRuleI18nMessage;
  description?: SchemaRuleI18nMessage;
}

export interface SchemaRuleManualRepairSchemaProperty {
  type: 'string' | 'boolean';
  widget?: 'select' | 'text' | 'textarea' | 'checkbox';
  title?: SchemaRuleI18nMessage;
  description?: SchemaRuleI18nMessage;
  options?: ReadonlyArray<SchemaRuleManualRepairOption>;
  defaultValue?: string | boolean;
}

export interface SchemaRuleManualRepairSchema {
  type: 'object';
  title?: SchemaRuleI18nMessage;
  description?: SchemaRuleI18nMessage;
  submitLabel?: SchemaRuleI18nMessage;
  required?: ReadonlyArray<string>;
  properties: Readonly<Record<string, SchemaRuleManualRepairSchemaProperty>>;
}

export interface SchemaRuleRepairHint {
  available: boolean;
  mode: 'auto' | 'manual';
  reason?: SchemaRuleI18nMessage;
  description?: SchemaRuleI18nMessage;
  manualRepairSchema?: SchemaRuleManualRepairSchema;
}

export type SchemaRuleManualRepairValues = Readonly<Record<string, SchemaRuleI18nValue>>;

export interface SchemaRuleManualRepairOptions {
  readonly dryRun?: boolean;
}

/**
 * Result of validating a schema rule against the current database state.
 */
export type SchemaRuleValidationResult = {
  /** Whether the rule is satisfied in the current database state */
  valid: boolean;
  /** Descriptions of missing schema objects (columns, indexes, etc.) */
  missing?: ReadonlyArray<string>;
  /** Structured, localizable descriptions of missing schema objects */
  missingItems?: ReadonlyArray<SchemaRuleDetailItem>;
  /** Descriptions of extra/unexpected schema objects */
  extra?: ReadonlyArray<string>;
  /** Structured, localizable descriptions of extra schema objects */
  extraItems?: ReadonlyArray<SchemaRuleDetailItem>;
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
   * Whether this rule can be auto-repaired by replaying `up()`.
   * Rules that need human intervention should mark themselves as `manual`.
   */
  readonly repairMode?: 'auto' | 'manual';

  /**
   * Optional structured repair metadata for UI consumers.
   * Manual rules can return a reason and a form-like schema describing
   * the user choices needed to proceed with repair.
   */
  getRepairHint?(
    ctx: SchemaRuleContext,
    validation: SchemaRuleValidationResult
  ): Result<SchemaRuleRepairHint | undefined, DomainError>;

  /**
   * Executes a rule-specific manual repair path when auto repair is not sufficient.
   * Backend services should only orchestrate/dispatch into this hook.
   */
  manualRepair?(
    ctx: SchemaRuleContext,
    values: SchemaRuleManualRepairValues | undefined,
    options?: SchemaRuleManualRepairOptions
  ): Promise<Result<void, DomainError>>;

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
