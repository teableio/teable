import type { IFieldMap } from '../../formula';
import type { ConditionalRollupFieldCore } from '../field';
import { FieldType } from '../field/constant';
import type { FormulaFieldCore } from '../field/derivate/formula.field';
import type { LinkFieldCore } from '../field/derivate/link.field';
import type { FieldCore } from '../field/field';
import { isLinkField } from '../field/field.util';
import {
  isConditionalLookupOptions,
  isLinkLookupOptions,
} from '../field/lookup-options-base.schema';

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
   * Get fields ordered by dependency (topological order)
   * - Formula fields depend on fields referenced in their expression
   * - Lookup fields depend on their link field
   * - Rollup fields depend on their link field
   * The order is stable relative to original positions when possible.
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  get ordered(): FieldCore[] {
    const fields = this._fields;
    const idToIndex = new Map<string, number>();
    const idToField = new Map<string, FieldCore>();

    fields.forEach((f, i) => {
      idToIndex.set(f.id, i);
      idToField.set(f.id, f);
    });

    // Build adjacency list dep -> dependents and in-degree counts
    const adjacency = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();
    for (const f of fields) {
      inDegree.set(f.id, 0);
    }

    const addEdge = (fromId: string, toId: string) => {
      if (!idToField.has(fromId) || !idToField.has(toId) || fromId === toId) return;
      let set = adjacency.get(fromId);
      if (!set) {
        set = new Set<string>();
        adjacency.set(fromId, set);
      }
      if (!set.has(toId)) {
        set.add(toId);
        inDegree.set(toId, (inDegree.get(toId) || 0) + 1);
      }
    };

    for (const f of fields) {
      // Collect dependencies for each field
      let deps: string[] = [];
      if (f.type === FieldType.Formula) {
        // Prefer instance method if available, fallback to static helper
        deps = (f as unknown as FormulaFieldCore).getReferenceFieldIds?.();
      }

      // Lookup fields depend on their link field
      if (f.isLookup) {
        const linkFieldId = getLinkLookupFieldId(f.lookupOptions);
        if (linkFieldId) {
          deps = [...deps, linkFieldId];
        }
      }

      // Rollup fields also depend on their link field
      if (f.type === FieldType.Rollup) {
        const linkFieldId = getLinkLookupFieldId(f.lookupOptions);
        if (linkFieldId) {
          deps = [...deps, linkFieldId];
        }
      }

      if (f.type === FieldType.ConditionalRollup) {
        const linkFieldId = getLinkLookupFieldId(f.lookupOptions);
        if (linkFieldId) {
          deps = [...deps, linkFieldId];
        }
      }

      // Create edges dep -> f.id
      for (const depId of new Set(deps)) {
        addEdge(depId, f.id);
      }
    }

    // Kahn's algorithm with stable ordering by original index
    const zeroQueue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) zeroQueue.push(id);
    }
    zeroQueue.sort((a, b) => idToIndex.get(a)! - idToIndex.get(b)!);

    const resultIds: string[] = [];
    while (zeroQueue.length > 0) {
      const id = zeroQueue.shift()!;
      resultIds.push(id);
      const neighbors = adjacency.get(id);
      if (!neighbors) continue;
      // To keep stability, process neighbors by original index
      const orderedNeighbors = Array.from(neighbors).sort(
        (a, b) => idToIndex.get(a)! - idToIndex.get(b)!
      );
      for (const nb of orderedNeighbors) {
        const nextDeg = (inDegree.get(nb) || 0) - 1;
        inDegree.set(nb, nextDeg);
        if (nextDeg === 0) {
          // insert in position to keep queue ordered by original index
          const idx = zeroQueue.findIndex((x) => idToIndex.get(x)! > idToIndex.get(nb)!);
          if (idx === -1) zeroQueue.push(nb);
          else zeroQueue.splice(idx, 0, nb);
        }
      }
    }

    // If cycles exist, append remaining nodes by original order
    if (resultIds.length < fields.length) {
      const remaining = fields
        .map((f, i) => ({ id: f.id, i }))
        .filter(({ id }) => !resultIds.includes(id))
        .sort((a, b) => a.i - b.i)
        .map(({ id }) => id);
      resultIds.push(...remaining);
    }

    return resultIds.map((id) => idToField.get(id)!) as FieldCore[];
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
  // eslint-disable-next-line sonarjs/cognitive-complexity
  getAllForeignTableIds(): Set<string> {
    const foreignTableIds = new Set<string>();

    for (const field of this) {
      if (field.type === FieldType.ConditionalRollup) {
        const foreignTableId = (field as ConditionalRollupFieldCore).getForeignTableId?.();
        if (foreignTableId) {
          foreignTableIds.add(foreignTableId);
        }
        continue;
      }

      if (field.isConditionalLookup) {
        const options = field.lookupOptions;
        const foreignTableId = isConditionalLookupOptions(options)
          ? options.foreignTableId
          : undefined;
        if (foreignTableId) {
          foreignTableIds.add(foreignTableId);
        }
        continue;
      }
      if (!isLinkField(field)) continue;
      // Skip errored link fields to avoid traversing deleted/missing tables
      if (field.hasError) continue;
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
const getLinkLookupFieldId = (options: FieldCore['lookupOptions']): string | undefined => {
  return options && isLinkLookupOptions(options) ? options.linkFieldId : undefined;
};
