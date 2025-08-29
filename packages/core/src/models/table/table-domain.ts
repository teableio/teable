import type { IFieldMap } from '../../formula';
import type { FieldCore } from '../field/field';
import { TableFields } from './table-fields';

/**
 * TableDomain represents a table with its fields and provides methods to interact with them
 * This is a domain object that encapsulates table-related business logic
 */
export class TableDomain {
  readonly id: string;
  readonly name: string;
  readonly dbTableName: string;
  readonly icon?: string;
  readonly description?: string;
  readonly lastModifiedTime: string;
  readonly baseId?: string;
  readonly dbViewName?: string;

  private readonly _fields: TableFields;

  constructor(params: {
    id: string;
    name: string;
    dbTableName: string;
    lastModifiedTime: string;
    icon?: string;
    description?: string;
    baseId?: string;
    fields?: FieldCore[];
    dbViewName?: string;
  }) {
    this.id = params.id;
    this.name = params.name;
    this.dbTableName = params.dbTableName;
    this.icon = params.icon;
    this.description = params.description;
    this.lastModifiedTime = params.lastModifiedTime;
    this.baseId = params.baseId;
    this.dbViewName = params.dbViewName;

    this._fields = new TableFields(params.fields);
  }

  getTableNameAndId() {
    return `${this.name}_${this.id}`;
  }

  /**
   * Get the fields collection
   */
  get fields(): TableFields {
    return this._fields;
  }

  /**
   * Get all fields as readonly array
   */
  get fieldList(): readonly FieldCore[] {
    return this._fields.fields;
  }

  get fieldMap(): IFieldMap {
    return this._fields.toFieldMap();
  }

  /**
   * Get field count
   */
  get fieldCount(): number {
    return this._fields.length;
  }

  /**
   * Check if table has any fields
   */
  get hasFields(): boolean {
    return !this._fields.isEmpty;
  }

  /**
   * Add a field to the table
   */
  addField(field: FieldCore): void {
    this._fields.add(field);
  }

  /**
   * Add multiple fields to the table
   */
  addFields(fields: FieldCore[]): void {
    this._fields.addMany(fields);
  }

  /**
   * Remove a field from the table
   */
  removeField(fieldId: string): boolean {
    return this._fields.remove(fieldId);
  }

  /**
   * Find a field by id
   */
  getField(fieldId: string): FieldCore | undefined {
    return this._fields.findById(fieldId);
  }

  /**
   * Find a field by id, throw error if not found
   */
  mustGetField(fieldId: string): FieldCore {
    const field = this.getField(fieldId);
    if (!field) {
      throw new Error(`Field ${fieldId} not found`);
    }
    return field;
  }

  /**
   * Find a field by name
   */
  getFieldByName(name: string): FieldCore | undefined {
    return this._fields.findByName(name);
  }

  /**
   * Find a field by database field name
   */
  getFieldByDbName(dbFieldName: string): FieldCore | undefined {
    return this._fields.findByDbFieldName(dbFieldName);
  }

  /**
   * Check if a field exists
   */
  hasField(fieldId: string): boolean {
    return this._fields.hasField(fieldId);
  }

  /**
   * Check if a field name exists
   */
  hasFieldName(name: string): boolean {
    return this._fields.hasFieldName(name);
  }

  /**
   * Get the primary field
   */
  getPrimaryField(): FieldCore | undefined {
    return this._fields.getPrimaryField();
  }

  /**
   * Get all computed fields
   */
  getComputedFields(): FieldCore[] {
    return this._fields.getComputedFields();
  }

  /**
   * Get all lookup fields
   */
  getLookupFields(): FieldCore[] {
    return this._fields.getLookupFields();
  }

  /**
   * Update a field in the table
   */
  updateField(fieldId: string, updatedField: FieldCore): boolean {
    return this._fields.update(fieldId, updatedField);
  }

  /**
   * Get all field ids
   */
  getFieldIds(): string[] {
    return this._fields.getIds();
  }

  /**
   * Get all field names
   */
  getFieldNames(): string[] {
    return this._fields.getNames();
  }

  /**
   * Create a field map by id
   */
  createFieldMap(): Map<string, FieldCore> {
    return this._fields.toFieldMap();
  }

  /**
   * Create a field map by name
   */
  createFieldNameMap(): Map<string, FieldCore> {
    return this._fields.toFieldNameMap();
  }

  /**
   * Filter fields by predicate
   */
  filterFields(predicate: (field: FieldCore) => boolean): FieldCore[] {
    return this._fields.filter(predicate);
  }

  /**
   * Map fields to another type
   */
  mapFields<T>(mapper: (field: FieldCore) => T): T[] {
    return this._fields.map(mapper);
  }

  /**
   * Get all foreign table IDs from link fields
   */
  getAllForeignTableIds(): Set<string> {
    return this._fields.getAllForeignTableIds();
  }

  /**
   * Create a copy of the table domain object
   */
  clone(): TableDomain {
    return new TableDomain({
      id: this.id,
      name: this.name,
      dbTableName: this.dbTableName,
      icon: this.icon,
      description: this.description,
      lastModifiedTime: this.lastModifiedTime,
      baseId: this.baseId,
      dbViewName: this.dbViewName,
      fields: this._fields.toArray(),
    });
  }

  /**
   * Convert to plain object representation
   */
  toPlainObject() {
    return {
      id: this.id,
      name: this.name,
      dbTableName: this.dbTableName,
      icon: this.icon,
      description: this.description,
      lastModifiedTime: this.lastModifiedTime,
      baseId: this.baseId,
      dbViewName: this.dbViewName,
      fields: this._fields.toArray(),
      fieldCount: this.fieldCount,
    };
  }
}
