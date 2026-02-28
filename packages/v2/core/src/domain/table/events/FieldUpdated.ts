import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { FieldId } from '../fields/FieldId';
import type { TableId } from '../TableId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export type FieldUpdatedValueChange = {
  oldValue: unknown;
  newValue: unknown;
};

/**
 * Domain event emitted when a field is updated.
 *
 * This event is generated for both property updates (name, options, constraints)
 * and type conversions. Consumers can inspect the `updatedProperties` array
 * to understand what changed.
 *
 * Note: For type conversions, the entire field definition changes, so
 * `updatedProperties` may contain 'type' along with other changed properties.
 */
export class FieldUpdated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.fieldUpdated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly fieldId: FieldId,
    readonly updatedProperties: ReadonlyArray<string>,
    readonly changes: Readonly<Record<string, FieldUpdatedValueChange>>,
    readonly oldVersion?: number,
    readonly newVersion?: number
  ) {
    super(tableId, baseId);
  }

  /**
   * Create a FieldUpdated event.
   *
   * @param params.tableId - The table containing the field
   * @param params.baseId - The base containing the table
   * @param params.fieldId - The field that was updated
   * @param params.updatedProperties - List of property names that changed
   *                                   (e.g., ['name'], ['options', 'formatting'], ['type'])
   */
  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    fieldId: FieldId;
    updatedProperties: ReadonlyArray<string>;
    changes?: Readonly<Record<string, FieldUpdatedValueChange>>;
    oldVersion?: number;
    newVersion?: number;
  }): FieldUpdated {
    return new FieldUpdated(
      params.tableId,
      params.baseId,
      params.fieldId,
      params.updatedProperties,
      params.changes ?? {},
      params.oldVersion,
      params.newVersion
    );
  }

  /**
   * Check if a specific property was updated.
   */
  hasPropertyUpdate(property: string): boolean {
    return this.updatedProperties.includes(property);
  }

  getPropertyChange(property: string): FieldUpdatedValueChange | undefined {
    return this.changes[property];
  }

  /**
   * Check if this is a type conversion event.
   */
  isTypeConversion(): boolean {
    return this.hasPropertyUpdate('type');
  }
}
