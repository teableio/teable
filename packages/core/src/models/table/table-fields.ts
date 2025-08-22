import type { IFieldMap } from '../../formula';
import type { LinkFieldCore } from '../field/derivate/link.field';
import type { FieldCore } from '../field/field';
import { isLinkField } from '../field/field.util';

/**
 * TableFields represents a collection of fields within a table
 * This class provides methods to manage and query fields
 */
export class TableFields {
  private readonly _fields: FieldCore[];

  constructor(fields: FieldCore[] = []) {
    this._fields = [...fields];
  }

  /**
   * Get all fields as readonly array
   */
  get fields(): readonly FieldCore[] {
    return this._fields;
  }

  /**
   * Get the number of fields
   */
  get length(): number {
    return this._fields.length;
  }

  /**
   * Check if fields collection is empty
   */
  get isEmpty(): boolean {
    return this._fields.length === 0;
  }

  /**
   * Add a field to the collection
   */
  add(field: FieldCore): void {
    this._fields.push(field);
  }

  /**
   * Add multiple fields to the collection
   */
  addMany(fields: FieldCore[]): void {
    this._fields.push(...fields);
  }

  /**
   * Remove a field by id
   */
  remove(fieldId: string): boolean {
    const index = this._fields.findIndex((field) => field.id === fieldId);
    if (index !== -1) {
      this._fields.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Find a field by id
   */
  findById(fieldId: string): FieldCore | undefined {
    return this._fields.find((field) => field.id === fieldId);
  }

  /**
   * Find a field by name
   */
  findByName(name: string): FieldCore | undefined {
    return this._fields.find((field) => field.name === name);
  }

  /**
   * Find a field by database field name
   */
  findByDbFieldName(dbFieldName: string): FieldCore | undefined {
    return this._fields.find((field) => field.dbFieldName === dbFieldName);
  }

  /**
   * Get all field ids
   */
  getIds(): string[] {
    return this._fields.map((field) => field.id);
  }

  /**
   * Get all field names
   */
  getNames(): string[] {
    return this._fields.map((field) => field.name);
  }

  /**
   * Filter fields by predicate
   */
  filter(predicate: (field: FieldCore) => boolean): FieldCore[] {
    return this._fields.filter(predicate);
  }

  /**
   * Map fields to another type
   */
  map<T>(mapper: (field: FieldCore) => T): T[] {
    return this._fields.map(mapper);
  }

  /**
   * Check if a field exists by id
   */
  hasField(fieldId: string): boolean {
    return this._fields.some((field) => field.id === fieldId);
  }

  /**
   * Check if a field name exists
   */
  hasFieldName(name: string): boolean {
    return this._fields.some((field) => field.name === name);
  }

  /**
   * Get primary field (if exists)
   */
  getPrimaryField(): FieldCore | undefined {
    return this._fields.find((field) => field.isPrimary);
  }

  /**
   * Get computed fields
   */
  getComputedFields(): FieldCore[] {
    return this._fields.filter((field) => field.isComputed);
  }

  getLinkFields(): LinkFieldCore[] {
    return this._fields.filter(isLinkField);
  }

  /**
   * Get lookup fields
   */
  getLookupFields(): FieldCore[] {
    return this._fields.filter((field) => field.isLookup);
  }

  /**
   * Update a field in the collection
   */
  update(fieldId: string, updatedField: FieldCore): boolean {
    const index = this._fields.findIndex((field) => field.id === fieldId);
    if (index !== -1) {
      this._fields[index] = updatedField;
      return true;
    }
    return false;
  }

  /**
   * Clear all fields
   */
  clear(): void {
    this._fields.length = 0;
  }

  /**
   * Create a copy of the fields collection
   */
  clone(): TableFields {
    return new TableFields(this._fields);
  }

  /**
   * Convert to plain array
   */
  toArray(): FieldCore[] {
    return [...this._fields];
  }

  /**
   * Create field map by id
   */
  toFieldMap(): IFieldMap {
    return new Map(this._fields.map((field) => [field.id, field]));
  }

  /**
   * Create field map by name
   */
  toFieldNameMap(): Map<string, FieldCore> {
    return new Map(this._fields.map((field) => [field.name, field]));
  }

  /**
   * Get all foreign table ids from link fields
   */
  getAllForeignTableIds(): Set<string> {
    const foreignTableIds = new Set<string>();

    for (const field of this) {
      if (!isLinkField(field)) continue;
      const foreignTableId = field.getForeignTableId();
      if (foreignTableId) {
        foreignTableIds.add(foreignTableId);
      }
    }

    return foreignTableIds;
  }

  /**
   * Iterator support for for...of loops
   */
  *[Symbol.iterator](): Iterator<FieldCore> {
    for (const field of this._fields) {
      yield field;
    }
  }
}
