import type { Table, DomainError, ICellValueSpec, FieldId } from '@teable/v2-core';
import { ok } from '@teable/v2-core';
import type { Kysely } from 'kysely';
import { err, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { CellValueMutateVisitor } from '../../visitors/CellValueMutateVisitor';
import type { CompiledSqlStatement } from '../insert';
import type { DynamicDB } from '../ITableRecordQueryBuilder';

/**
 * Result of building UPDATE SQLs for a record (compiled form).
 */
export interface RecordUpdateSqlResult {
  /** The main UPDATE statement */
  mainUpdate: CompiledSqlStatement;
  /** Additional SQL statements (junction table updates, FK updates for link fields) */
  additionalStatements: CompiledSqlStatement[];
  /** Field IDs that were changed (for computed field propagation) */
  changedFieldIds: FieldId[];
}

/**
 * Context for building update data.
 */
export interface RecordUpdateBuilderContext {
  actorId: string;
  now: string;
}

/**
 * Builds UPDATE SQL statements for a record using mutation specification.
 *
 * This builder delegates to CellValueMutateVisitor to generate SQL statements,
 * then wraps them with descriptions for EXPLAIN analysis.
 *
 * @example
 * ```typescript
 * const builder = new RecordUpdateBuilder(db);
 * const result = builder.build({
 *   table,
 *   tableName: 'my_table',
 *   mutateSpec,
 *   recordId: 'rec_xxx',
 *   context: { actorId: 'usr_xxx', now: new Date().toISOString() },
 * });
 * ```
 */
export class RecordUpdateBuilder {
  constructor(private readonly db: Kysely<DynamicDB>) {}

  /**
   * Build UPDATE SQL statements for a record using mutation specification.
   * Use this for EXPLAIN analysis or when you need the actual SQL strings.
   */
  build(params: {
    table: Table;
    tableName: string;
    tableDisplayName?: string;
    mutateSpec: ICellValueSpec;
    recordId: string;
    context: RecordUpdateBuilderContext;
  }): Result<RecordUpdateSqlResult, DomainError> {
    const { table, tableName, tableDisplayName, mutateSpec, recordId, context } = params;
    const db = this.db;

    return safeTry<RecordUpdateSqlResult, DomainError>(function* () {
      // Use CellValueMutateVisitor to generate all SQL statements
      const mutateVisitor = CellValueMutateVisitor.create(db, table, tableName, {
        recordId,
        actorId: context.actorId,
        now: context.now,
      });

      yield* mutateSpec.accept(mutateVisitor);
      const statementsResult = mutateVisitor.build();
      if (statementsResult.isErr()) {
        return err(statementsResult.error);
      }

      const { mainUpdate, additionalStatements, changedFieldIds } = statementsResult.value;

      // Wrap with descriptions for EXPLAIN analysis
      return ok({
        mainUpdate: {
          description: `Update record in ${tableDisplayName ?? tableName}`,
          compiled: mainUpdate,
        },
        additionalStatements: additionalStatements.map((stmt, index) => ({
          description: `Additional statement ${index + 1}`,
          compiled: stmt,
        })),
        changedFieldIds,
      });
    });
  }
}
