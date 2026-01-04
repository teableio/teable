import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../domain/base/BaseId';
import { domainError, isNotFoundError, type DomainError } from '../../domain/shared/DomainError';
import { TableByIdSpec } from '../../domain/table/specs/TableByIdSpec';
import type { Table } from '../../domain/table/Table';
import { Table as TableAggregate } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import * as ExecutionContextPort from '../../ports/ExecutionContext';
import * as TableRepositoryPort from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';
import { TraceSpan } from '../../ports/TraceSpan';

/**
 * Application Service: Table Query Service
 *
 * ## Responsibilities
 *
 * Provides common table lookup operations used across multiple CommandHandlers and QueryHandlers.
 * This service encapsulates:
 * - Table lookup by ID with proper error handling
 * - Consistent "not found" error responses
 * - Repository coordination without domain logic
 *
 * ## When to Use
 *
 * Use this service when:
 * - A handler needs to fetch a Table by its ID before performing operations
 * - Multiple handlers share the same lookup + not-found-check pattern
 * - You want consistent error messages for missing tables
 *
 * ## When NOT to Use
 *
 * Do NOT use this service when:
 * - You need complex query logic (use repository directly with custom specs)
 * - You're already using TableUpdateFlow (it has its own resolveTable)
 * - Domain logic is involved (that belongs in Domain Services or the aggregate)
 *
 * ## Examples
 *
 * ```typescript
 * // In a CommandHandler:
 * const table = yield* await this.tableQueryService.getById(context, command.tableId);
 * const record = yield* table.createRecord(command.fieldValues);
 * ```
 *
 * ```typescript
 * // With baseId constraint:
 * const table = yield* await this.tableQueryService.getByIdInBase(
 *   context,
 *   command.baseId,
 *   command.tableId
 * );
 * ```
 */
@injectable()
export class TableQueryService {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository
  ) {}

  /**
   * Finds a table by its ID.
   *
   * @param context - Execution context (includes transaction, actor, tracer)
   * @param tableId - The table's unique identifier
   * @returns Result containing the Table or a DomainError (notFound if table doesn't exist)
   *
   * @example
   * ```typescript
   * const tableResult = await tableQueryService.getById(context, tableId);
   * if (tableResult.isErr()) return err(tableResult.error);
   * const table = tableResult.value;
   * ```
   */
  @TraceSpan()
  async getById(
    context: ExecutionContextPort.IExecutionContext,
    tableId: TableId
  ): Promise<Result<Table, DomainError>> {
    // Use TableByIdSpec directly since we don't have baseId constraint
    const spec = TableByIdSpec.create(tableId);
    const tableResult = await this.tableRepository.findOne(context, spec);

    if (tableResult.isErr()) {
      if (isNotFoundError(tableResult.error)) {
        return err(
          domainError.notFound({
            code: 'table.not_found',
            message: `Table not found: ${tableId.toString()}`,
          })
        );
      }
      return err(tableResult.error);
    }

    const table = tableResult.value;
    if (!table) {
      return err(
        domainError.notFound({
          code: 'table.not_found',
          message: `Table not found: ${tableId.toString()}`,
        })
      );
    }

    return ok(table);
  }

  /**
   * Finds a table by its ID within a specific base.
   *
   * Use this when you need to ensure the table belongs to a specific base,
   * providing an additional authorization/scoping check.
   *
   * @param context - Execution context
   * @param baseId - The base that must contain the table
   * @param tableId - The table's unique identifier
   * @returns Result containing the Table or a DomainError
   *
   * @example
   * ```typescript
   * const table = yield* await tableQueryService.getByIdInBase(
   *   context,
   *   command.baseId,
   *   command.tableId
   * );
   * ```
   */
  async getByIdInBase(
    context: ExecutionContextPort.IExecutionContext,
    baseId: BaseId,
    tableId: TableId
  ): Promise<Result<Table, DomainError>> {
    const tableRepository = this.tableRepository;
    return safeTry<Table, DomainError>(async function* () {
      const spec = yield* TableAggregate.specs(baseId).byId(tableId).build();
      const tableResult = await tableRepository.findOne(context, spec);

      if (tableResult.isErr()) {
        if (isNotFoundError(tableResult.error)) {
          return err(
            domainError.notFound({
              code: 'table.not_found',
              message: `Table not found: ${tableId.toString()} in base ${baseId.toString()}`,
            })
          );
        }
        return err(tableResult.error);
      }

      const table = tableResult.value;
      if (!table) {
        return err(
          domainError.notFound({
            code: 'table.not_found',
            message: `Table not found: ${tableId.toString()} in base ${baseId.toString()}`,
          })
        );
      }

      return ok(table);
    });
  }

  /**
   * Checks if a table exists by its ID.
   *
   * Use this for existence checks without loading the full aggregate.
   * Note: Currently loads the full table; optimize with count query if needed.
   *
   * @param context - Execution context
   * @param tableId - The table's unique identifier
   * @returns Result<boolean> - true if exists, false otherwise
   */
  async exists(
    context: ExecutionContextPort.IExecutionContext,
    tableId: TableId
  ): Promise<Result<boolean, DomainError>> {
    const result = await this.getById(context, tableId);
    if (result.isErr()) {
      if (result.error.code === 'table.not_found') {
        return ok(false);
      }
      return err(result.error);
    }
    return ok(true);
  }
}
