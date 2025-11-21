import type { IFieldMap } from '../../formula';
import { FieldType } from '../field/constant';
import type { FieldCore } from '../field/field';
import type { ILookupLinkOptions } from '../field/lookup-options-base.schema';
import { isLinkLookupOptions } from '../field/lookup-options-base.schema';
import { FieldKeyType } from '../record';
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

  getFieldsByProjection(projection?: string[]): FieldCore[] {
    if (!projection || projection.length === 0) {
      return this.fieldList as FieldCore[];
    }
    const fieldSet = new Set(projection);
    return this.fieldList.filter(
      (field) =>
        fieldSet.has(field.id) || fieldSet.has(field.name) || fieldSet.has(field.dbFieldName)
    );
  }

  /**
   * Get fields map by specified key type
   */
  getFieldsMap(fieldKeyType: FieldKeyType): Map<string, FieldCore> {
    switch (fieldKeyType) {
      case FieldKeyType.Id:
        return this._fields.toFieldMap();
      case FieldKeyType.Name:
        return this._fields.toFieldNameMap();
      case FieldKeyType.DbFieldName:
        return this._fields.toFieldDbNameMap();
      default:
        throw new Error(`Unsupported field key type: ${fieldKeyType}`);
    }
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
   * Get the last modified fields
   */
  getLastModifiedFields(): FieldCore[] {
    return this._fields.getLastModifiedFields();
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

  getLinkFieldsByProjection(projection?: Iterable<string>): FieldCore[] {
    if (!projection) {
      return this._fields.filter(
        (field) => field.type === FieldType.Link && !field.isLookup
      ) as FieldCore[];
    }

    const expanded = this.expandFieldIdsWithLinkDependencies(projection);
    if (!expanded.size) {
      return [];
    }

    return Array.from(expanded)
      .map((fieldId) => this.getField(fieldId))
      .filter(
        (field): field is FieldCore => !!field && field.type === FieldType.Link && !field.isLookup
      );
  }

  /**
   * Get all foreign table IDs from link fields
   */
  getAllForeignTableIds(fieldIds?: string[]): Set<string> {
    if (!fieldIds || fieldIds.length === 0) {
      return this._fields.getAllForeignTableIds();
    }

    const expandedFieldIds = this.expandFieldIdsWithLinkDependencies(fieldIds);
    return this._fields.getAllForeignTableIds([...expandedFieldIds]);
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private expandFieldIdsWithLinkDependencies(fieldIds: Iterable<string>): Set<string> {
    const visited = new Set<string>();
    const stack = [...fieldIds];

    while (stack.length) {
      const fieldId = stack.pop();
      if (!fieldId || visited.has(fieldId)) {
        continue;
      }
      visited.add(fieldId);

      const field = this.getField(fieldId);
      if (!field) {
        continue;
      }

      const linkFields = field.getLinkFields(this);
      for (const linkField of linkFields) {
        if (!visited.has(linkField.id)) {
          stack.push(linkField.id);
        }
      }

      const lookupOptions = (field as { lookupOptions?: ILookupLinkOptions }).lookupOptions;
      if (lookupOptions && isLinkLookupOptions(lookupOptions)) {
        const linkFieldId = lookupOptions.linkFieldId;
        if (linkFieldId && !visited.has(linkFieldId)) {
          stack.push(linkFieldId);
        }
      }
    }

    return visited;
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
