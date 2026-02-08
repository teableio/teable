import type {
  BaseId,
  DomainError,
  IExecutionContext,
  ITableRepository,
  Table,
} from '@teable/v2-core';
import { domainError } from '@teable/v2-core';
import type { Result } from 'neverthrow';
import { ok, err } from 'neverthrow';

import {
  createMetaValidationContext,
  createMetaValidationContextFromTables,
  type IMetaValidationContext,
} from './MetaValidationContext';
import type { MetaValidationIssue, MetaValidationResult } from './MetaValidationResult';
import { MetaValidationVisitor } from './MetaValidationVisitor';

/**
 * Options for MetaChecker.
 */
export interface MetaCheckerOptions {
  /** Table repository for loading tables */
  tableRepository: ITableRepository;
  /** Execution context */
  executionContext: IExecutionContext;
}

/**
 * MetaChecker validates field configurations and cross-table references.
 *
 * Uses an async generator to yield issues one by one, enabling streaming
 * results to clients for real-time feedback.
 *
 * @example
 * ```typescript
 * const checker = new MetaChecker({ tableRepository, executionContext });
 *
 * // Stream issues
 * for await (const issue of checker.checkTable(table, baseId)) {
 *   console.log(issue.message);
 * }
 *
 * // Or collect all issues
 * const result = await checker.checkTableAll(table, baseId);
 * if (result.isOk()) {
 *   console.log(`Found ${result.value.issues.length} issues`);
 * }
 * ```
 */
export class MetaChecker {
  constructor(private readonly options: MetaCheckerOptions) {}

  /**
   * Check a table's meta data and yield issues one by one.
   *
   * @param table - The table to validate
   * @param baseId - The base ID containing the table
   * @yields MetaValidationIssue for each problem found
   */
  async *checkTable(table: Table, baseId: BaseId): AsyncGenerator<MetaValidationIssue> {
    // Load context with all tables in the base
    const ctxResult = await createMetaValidationContext(
      baseId,
      table,
      this.options.tableRepository,
      this.options.executionContext
    );

    if (ctxResult.isErr()) {
      yield {
        fieldId: '',
        fieldName: '',
        fieldType: '',
        category: 'reference',
        severity: 'error',
        message: `Failed to load validation context: ${ctxResult.error.message}`,
      };
      return;
    }

    yield* this.checkTableWithContext(table, ctxResult.value);
  }

  /**
   * Check a table using a pre-loaded context.
   *
   * @param table - The table to validate
   * @param ctx - Pre-loaded validation context
   * @yields MetaValidationIssue for each problem found
   */
  async *checkTableWithContext(
    table: Table,
    ctx: IMetaValidationContext
  ): AsyncGenerator<MetaValidationIssue> {
    const visitor = new MetaValidationVisitor(ctx);

    for (const field of table.getFields()) {
      try {
        const issuesResult = field.accept(visitor);

        if (issuesResult.isErr()) {
          yield {
            fieldId: field.id().toString(),
            fieldName: field.name().toString(),
            fieldType: field.type().toString(),
            category: 'schema',
            severity: 'error',
            message: `Validation error: ${issuesResult.error.message}`,
          };
          continue;
        }

        for (const issue of issuesResult.value) {
          yield issue;
        }
      } catch (error) {
        yield {
          fieldId: field.id().toString(),
          fieldName: field.name().toString(),
          fieldType: field.type().toString(),
          category: 'schema',
          severity: 'error',
          message: `Unexpected error: ${describeError(error)}`,
        };
      }
    }
  }

  /**
   * Check a table and return all issues at once.
   *
   * @param table - The table to validate
   * @param baseId - The base ID containing the table
   * @returns MetaValidationResult with all issues
   */
  async checkTableAll(
    table: Table,
    baseId: BaseId
  ): Promise<Result<MetaValidationResult, DomainError>> {
    const issues: MetaValidationIssue[] = [];
    let checkedFieldCount = 0;

    try {
      for await (const issue of this.checkTable(table, baseId)) {
        issues.push(issue);
      }
      checkedFieldCount = table.getFields().length;
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Meta validation failed: ${describeError(error)}`,
        })
      );
    }

    return ok({
      tableId: table.id().toString(),
      tableName: table.name().toString(),
      issues,
      checkedFieldCount,
      timestamp: Date.now(),
    });
  }

  /**
   * Check multiple tables in a base.
   *
   * @param tables - Tables to validate
   * @param baseId - The base ID
   * @yields MetaValidationIssue for each problem found (includes tableId context)
   */
  async *checkTables(
    tables: ReadonlyArray<Table>,
    baseId: BaseId
  ): AsyncGenerator<MetaValidationIssue & { tableId: string; tableName: string }> {
    // Create a shared context from all tables
    for (const table of tables) {
      const ctx = createMetaValidationContextFromTables(baseId, table, tables);

      for await (const issue of this.checkTableWithContext(table, ctx)) {
        yield {
          ...issue,
          tableId: table.id().toString(),
          tableName: table.name().toString(),
        };
      }
    }
  }
}

/**
 * Standalone function to check a single table's meta data.
 *
 * @param table - The table to validate
 * @param baseId - The base ID
 * @param options - Checker options
 * @returns AsyncGenerator yielding issues
 */
export async function* checkTableMeta(
  table: Table,
  baseId: BaseId,
  options: MetaCheckerOptions
): AsyncGenerator<MetaValidationIssue> {
  const checker = new MetaChecker(options);
  yield* checker.checkTable(table, baseId);
}

/**
 * Standalone function to check a table with pre-loaded tables.
 *
 * @param table - The table to validate
 * @param baseId - The base ID
 * @param allTables - All tables in the base (for reference validation)
 * @returns AsyncGenerator yielding issues
 */
export async function* checkTableMetaWithTables(
  table: Table,
  baseId: BaseId,
  allTables: ReadonlyArray<Table>
): AsyncGenerator<MetaValidationIssue> {
  const ctx = createMetaValidationContextFromTables(baseId, table, allTables);
  const visitor = new MetaValidationVisitor(ctx);

  for (const field of table.getFields()) {
    try {
      const issuesResult = field.accept(visitor);
      if (issuesResult.isErr()) {
        yield {
          fieldId: field.id().toString(),
          fieldName: field.name().toString(),
          fieldType: field.type().toString(),
          category: 'schema',
          severity: 'error',
          message: `Validation error: ${issuesResult.error.message}`,
        };
        continue;
      }
      for (const issue of issuesResult.value) {
        yield issue;
      }
    } catch (error) {
      yield {
        fieldId: field.id().toString(),
        fieldName: field.name().toString(),
        fieldType: field.type().toString(),
        category: 'schema',
        severity: 'error',
        message: `Unexpected error: ${describeError(error)}`,
      };
    }
  }
}

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
