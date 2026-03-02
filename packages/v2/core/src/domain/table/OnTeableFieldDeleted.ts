import type { Result } from 'neverthrow';

import type { DomainError } from '../shared/DomainError';
import type { ISpecification } from '../shared/specification/ISpecification';
import type { Field } from './fields/Field';
import type { ITableSpecVisitor } from './specs/ITableSpecVisitor';
import type { Table } from './Table';

/**
 * Context provided to entities when processing field-deletion side effects.
 */
export type FieldDeletionContext = {
  /** The table containing the entity that is handling the deletion */
  readonly table: Table;
  /** The table where the field was deleted from */
  readonly sourceTable: Table;
  /** Source table state before the field deletion */
  readonly previousSourceTable?: Table;
};

/**
 * Interface for entities that need to respond when a field is deleted.
 */
export interface OnTeableFieldDeleted {
  /**
   * Called when a field is deleted.
   *
   * @param deletedField The field that was deleted
   * @param context Additional context including source and host table state
   * @returns A composed spec to apply in response to deletion, or undefined
   */
  onFieldDeleted(
    deletedField: Field,
    context: FieldDeletionContext
  ): Result<ISpecification<Table, ITableSpecVisitor> | undefined, DomainError>;
}

/**
 * Type guard to check if an entity implements OnTeableFieldDeleted.
 */
export function implementsOnTeableFieldDeleted(entity: unknown): entity is OnTeableFieldDeleted {
  return (
    entity != null &&
    typeof entity === 'object' &&
    'onFieldDeleted' in entity &&
    typeof (entity as OnTeableFieldDeleted).onFieldDeleted === 'function'
  );
}
