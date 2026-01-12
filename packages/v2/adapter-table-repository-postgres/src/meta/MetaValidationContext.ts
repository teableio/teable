import type { Result } from 'neverthrow';
import { ok, err } from 'neverthrow';

import type {
  BaseId,
  DomainError,
  Field,
  IExecutionContext,
  ITableRepository,
} from '@teable/v2-core';
import { domainError, Table } from '@teable/v2-core';

/**
 * Context for meta validation that provides access to all tables and fields
 * in the base for reference validation.
 *
 * Pre-loads all tables in the base to enable validation of cross-table references
 * (e.g., link field's foreignTableId, symmetric field consistency).
 */
export interface IMetaValidationContext {
  /** The table being validated */
  readonly table: Table;

  /** Base ID containing the table */
  readonly baseId: BaseId;

  /** Pre-loaded tables by ID */
  readonly tablesById: ReadonlyMap<string, Table>;

  /** Pre-loaded fields by composite key (tableId:fieldId) */
  readonly fieldsById: ReadonlyMap<string, Field>;

  /**
   * Get a table by ID.
   */
  getTable(tableId: string): Table | undefined;

  /**
   * Get a field from a specific table.
   */
  getField(tableId: string, fieldId: string): Field | undefined;

  /**
   * Check if a table exists.
   */
  hasTable(tableId: string): boolean;

  /**
   * Check if a field exists in a table.
   */
  hasField(tableId: string, fieldId: string): boolean;
}

/**
 * Implementation of IMetaValidationContext.
 */
class MetaValidationContext implements IMetaValidationContext {
  constructor(
    readonly table: Table,
    readonly baseId: BaseId,
    readonly tablesById: ReadonlyMap<string, Table>,
    readonly fieldsById: ReadonlyMap<string, Field>
  ) {}

  getTable(tableId: string): Table | undefined {
    return this.tablesById.get(tableId);
  }

  getField(tableId: string, fieldId: string): Field | undefined {
    return this.fieldsById.get(`${tableId}:${fieldId}`);
  }

  hasTable(tableId: string): boolean {
    return this.tablesById.has(tableId);
  }

  hasField(tableId: string, fieldId: string): boolean {
    return this.fieldsById.has(`${tableId}:${fieldId}`);
  }
}

/**
 * Creates a MetaValidationContext by loading all tables in the base.
 *
 * @param baseId - The base ID to load tables from
 * @param table - The table being validated
 * @param tableRepository - Repository to load tables
 * @param executionContext - Execution context for the request
 * @returns Result containing the context or an error
 *
 * @example
 * ```typescript
 * const ctx = await createMetaValidationContext(
 *   baseId,
 *   table,
 *   tableRepository,
 *   executionContext
 * );
 * if (ctx.isOk()) {
 *   const foreignTable = ctx.value.getTable(foreignTableId);
 *   const symmetricField = ctx.value.getField(foreignTableId, symmetricFieldId);
 * }
 * ```
 */
export const createMetaValidationContext = async (
  baseId: BaseId,
  table: Table,
  tableRepository: ITableRepository,
  executionContext: IExecutionContext
): Promise<Result<IMetaValidationContext, DomainError>> => {
  try {
    // Load all tables in the base
    const specResult = Table.specs(baseId).build();
    if (specResult.isErr()) return err(specResult.error);

    const tablesResult = await tableRepository.find(executionContext, specResult.value);
    if (tablesResult.isErr()) return err(tablesResult.error);

    const tables = tablesResult.value;

    // Build tablesById map
    const tablesById = new Map<string, Table>();
    for (const t of tables) {
      tablesById.set(t.id().toString(), t);
    }

    // Ensure the target table is in the map
    if (!tablesById.has(table.id().toString())) {
      tablesById.set(table.id().toString(), table);
    }

    // Build fieldsById map (composite key: tableId:fieldId)
    const fieldsById = new Map<string, Field>();
    for (const t of tablesById.values()) {
      const tableId = t.id().toString();
      for (const field of t.getFields()) {
        const key = `${tableId}:${field.id().toString()}`;
        fieldsById.set(key, field);
      }
    }

    return ok(new MetaValidationContext(table, baseId, tablesById, fieldsById));
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to create meta validation context: ${describeError(error)}`,
      })
    );
  }
};

/**
 * Creates a MetaValidationContext from pre-loaded tables (for testing or when tables are already available).
 *
 * @param baseId - The base ID
 * @param table - The table being validated
 * @param tables - Pre-loaded tables
 * @returns The validation context
 */
export const createMetaValidationContextFromTables = (
  baseId: BaseId,
  table: Table,
  tables: ReadonlyArray<Table>
): IMetaValidationContext => {
  const tablesById = new Map<string, Table>();
  for (const t of tables) {
    tablesById.set(t.id().toString(), t);
  }

  if (!tablesById.has(table.id().toString())) {
    tablesById.set(table.id().toString(), table);
  }

  const fieldsById = new Map<string, Field>();
  for (const t of tablesById.values()) {
    const tableId = t.id().toString();
    for (const field of t.getFields()) {
      const key = `${tableId}:${field.id().toString()}`;
      fieldsById.set(key, field);
    }
  }

  return new MetaValidationContext(table, baseId, tablesById, fieldsById);
};

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message ? `${error.name}: ${error.message}` : error.name;
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    return json ?? String(error);
  } catch {
    return String(error);
  }
};
