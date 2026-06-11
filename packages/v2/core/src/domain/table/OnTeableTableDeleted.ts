import type { Result } from 'neverthrow';

import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { DomainError } from '../shared/DomainError';
import type { IDomainEvent } from '../shared/DomainEvent';
import type { ISpecification } from '../shared/specification/ISpecification';
import type { FieldId } from './fields/FieldId';
import type { ITableSpecVisitor } from './specs/ITableSpecVisitor';
import type { Table } from './Table';

export type TableDeletionAfterPersistHook = (
  context: IExecutionContext,
  updatedTable: Table,
  deletedTable: Table
) => Promise<Result<{ events: ReadonlyArray<IDomainEvent>; table: Table }, DomainError>>;

export type TableDeletionReaction = {
  readonly spec: ISpecification<Table, ITableSpecVisitor>;
  readonly afterPersist?: TableDeletionAfterPersistHook;
};

export type TableDeletionHookFactory = {
  readonly createFieldUpdateAfterPersistHook: (
    fieldId: FieldId,
    updateSpec: ISpecification<Table, ITableSpecVisitor>
  ) => TableDeletionAfterPersistHook;
};

/**
 * Context provided to entities when processing table-deletion side effects.
 */
export type TableDeletionContext = {
  /** The table containing the entity that is handling the deletion */
  readonly table: Table;
  /** Hook factory implemented by the application layer */
  readonly hooks: TableDeletionHookFactory;
};

/**
 * Interface for entities that need to respond when a table is deleted.
 */
export interface OnTeableTableDeleted {
  /**
   * Called when a table is deleted.
   *
   * @param deletedTable The table that is being deleted
   * @param context Additional context including the host table state
   * @returns A composed spec to apply in response to deletion, or undefined
   */
  onTableDeleted(
    deletedTable: Table,
    context: TableDeletionContext
  ): Result<TableDeletionReaction | undefined, DomainError>;
}

/**
 * Type guard to check if an entity implements OnTeableTableDeleted.
 */
export function implementsOnTeableTableDeleted(entity: unknown): entity is OnTeableTableDeleted {
  return (
    entity != null &&
    typeof entity === 'object' &&
    'onTableDeleted' in entity &&
    typeof (entity as OnTeableTableDeleted).onTableDeleted === 'function'
  );
}
