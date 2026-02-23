import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { ISpecification } from '../../shared/specification/ISpecification';
import type { ITableSpecVisitor } from '../specs/ITableSpecVisitor';
import type { Table } from '../Table';
import type { Field } from './Field';

/**
 * Context provided to fields when processing dependency updates.
 * Contains the host table and any related foreign tables that might be needed.
 */
export type FieldUpdateContext = {
  /** The table containing the dependent field */
  readonly table: Table;
  /** Foreign tables that might be needed for validation or computation */
  readonly foreignTables: ReadonlyArray<Table>;
};

/**
 * Interface for fields that need to respond to updates of their dependencies.
 *
 * When a field is updated, the FieldUpdateSideEffectService will notify all
 * dependent fields by calling their `onDependencyUpdated` method. This allows
 * dependent fields to:
 *
 * 1. Sync their metadata (e.g., LookupField syncing cellValueType from target)
 * 2. Recalculate derived values (e.g., FormulaField recalculating result type)
 * 3. Mark themselves as having errors (e.g., when a referenced field is deleted)
 *
 * The specs returned by `onDependencyUpdated` will be collected and executed
 * as part of the update transaction, ensuring cascading updates happen atomically.
 *
 * Example implementation for LookupField:
 * ```typescript
 * onDependencyUpdated(
 *   updatedField: Field,
 *   updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>,
 *   context: FieldUpdateContext
 * ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
 *   // Only respond if the updated field is our lookup target
 *   if (!this.lookupOptions().lookupFieldId().equals(updatedField.id())) {
 *     return ok([]);
 *   }
 *
 *   // Check if cellValueType changed and sync if needed
 *   const newCellValueType = updatedField.cellValueType();
 *   // ... generate sync specs
 * }
 * ```
 */
export interface OnTeableFieldUpdated {
  /**
   * Called when a field this field depends on is updated.
   *
   * @param updatedField The field that was updated
   * @param updateSpecs The specs that were applied to the updated field.
   *                    Dependent fields can inspect these to determine what changed
   *                    and decide how to respond.
   * @param context Additional context including the table and foreign tables
   * @returns Specs to apply to this field in response to the update,
   *          or an empty array if no changes are needed
   */
  onDependencyUpdated(
    updatedField: Field,
    updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>,
    context: FieldUpdateContext
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError>;
}

/**
 * Type guard to check if a field implements OnTeableFieldUpdated.
 */
export function implementsOnTeableFieldUpdated(
  field: Field
): field is Field & OnTeableFieldUpdated {
  return (
    'onDependencyUpdated' in field &&
    typeof (field as unknown as OnTeableFieldUpdated).onDependencyUpdated === 'function'
  );
}
