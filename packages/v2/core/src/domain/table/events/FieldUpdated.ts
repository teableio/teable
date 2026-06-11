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

export type FieldUpdatedPropertySemantics = {
  readonly realtimePath: ReadonlyArray<string>;
  readonly presencePath: ReadonlyArray<string>;
  readonly mayRequirePresence: boolean;
};

export const serializeFieldUpdatedValue = (value: unknown): unknown => {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeFieldUpdatedValue(item));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Object) {
    if ('toDto' in value && typeof value.toDto === 'function') {
      return serializeFieldUpdatedValue(value.toDto());
    }

    if ('value' in value && typeof value.value === 'function') {
      return serializeFieldUpdatedValue(value.value());
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, serializeFieldUpdatedValue(nested)])
    );
  }

  return value;
};

/**
 * Domain event emitted when a field is updated.
 *
 * This event is generated for both property updates (name, options, constraints)
 * and type conversions. Consumers can inspect the `updatedProperties` array
 * to understand what changed. Property-level realtime/presence semantics are
 * carried from the field-update spec visitor that produced the event.
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
    readonly propertySemantics: Readonly<Record<string, FieldUpdatedPropertySemantics>>,
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
    propertySemantics?: Readonly<Record<string, FieldUpdatedPropertySemantics>>;
    oldVersion?: number;
    newVersion?: number;
  }): FieldUpdated {
    return new FieldUpdated(
      params.tableId,
      params.baseId,
      params.fieldId,
      params.updatedProperties,
      params.changes ?? {},
      params.propertySemantics ?? {},
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

  realtimePathFor(property: string): ReadonlyArray<string> {
    return this.propertySemantics[property]?.realtimePath ?? [property];
  }

  presencePathFor(property: string): ReadonlyArray<string> {
    return this.propertySemantics[property]?.presencePath ?? [property];
  }

  propertyMayRequirePresence(property: string): boolean {
    return this.propertySemantics[property]?.mayRequirePresence ?? false;
  }

  mayRequirePresence(): boolean {
    return this.updatedProperties.some((property) => this.propertyMayRequirePresence(property));
  }

  /**
   * Check if this is a type conversion event.
   */
  isTypeConversion(): boolean {
    return this.hasPropertyUpdate('type');
  }
}
