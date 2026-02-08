import type { DomainError } from '@teable/v2-core';
import type { Result } from 'neverthrow';

/**
 * Edge kind for field dependencies.
 *
 * - `same_record`: Dependency within the same record (no link traversal needed)
 * - `cross_record`: Dependency across records via link (includes same-table self-referencing)
 */
export type FieldDependencyEdgeKind = 'same_record' | 'cross_record';

/**
 * Semantic hint for debugging and logging (does not affect propagation logic).
 *
 * Identifies the origin and nature of field dependency edges:
 *
 * - `formula_ref`: Formula field reference
 *   Indicates a formula field directly references another field's value.
 *   Example: formula `{fieldA} + {fieldB}` creates edges fieldA → formulaField and fieldB → formulaField.
 *   Sourced from the `reference` table which stores formula dependencies.
 *
 * - `lookup_source`: Lookup field's data source dependency
 *   Indicates a Lookup field depends on the source field in the linked table (cross-record dependency).
 *   When the source field value changes, the Lookup field must be recalculated.
 *   Example: Lookup(Order.ProductName) depends on Products.ProductName field.
 *
 * - `lookup_link`: Lookup/Rollup field's dependency on its Link field
 *   Indicates a Lookup or Rollup field depends on its associated Link field (same-record dependency).
 *   When the Link field's linked records change, the Lookup/Rollup value must be recalculated.
 *   Example: Lookup(Order.ProductName) depends on Order.Product (Link field).
 *
 * - `link_title`: Link field's display title dependency
 *   Indicates a Link field's displayed title depends on the lookupField in the linked table (usually the primary field).
 *   When the linked table's primary field value changes, the Link field's displayed title must be updated.
 *   Example: Order.Product (Link) displays the product name from Products.ProductName.
 *
 * - `rollup_source`: Rollup field's data source dependency
 *   Indicates a Rollup field depends on the aggregated source field in the linked table (cross-record dependency).
 *   When the source field value changes, the Rollup aggregation result must be recalculated.
 *   Example: Rollup(SUM, Orders.Amount) depends on Orders.Amount field.
 *
 * - `conditional_rollup_source`: ConditionalRollup field's data source dependency
 *   Indicates a ConditionalRollup field depends on fields in the target table (cross-record dependency).
 *   Unlike regular Rollup, it does not use a Link field for association but matches records via condition filters.
 *   When source or condition field values change, the condition must be re-evaluated and aggregation recalculated.
 *
 * - `conditional_lookup_source`: ConditionalLookup field's data source dependency
 *   Indicates a ConditionalLookup field depends on fields in the target table (cross-record dependency).
 *   Unlike regular Lookup, it does not use a Link field for association but matches records via condition filters.
 *   When source or condition field values change, the condition must be re-evaluated to fetch matching record values.
 */
export type FieldDependencyEdgeSemantic =
  | 'formula_ref'
  | 'lookup_source'
  | 'lookup_link'
  | 'lookup_filter'
  | 'link_title'
  | 'rollup_source'
  | 'rollup_filter'
  | 'conditional_rollup_source'
  | 'conditional_lookup_source';

/**
 * A dependency edge between two fields.
 * Uses string IDs for portability across different contexts.
 */
export interface FieldDependencyEdge {
  fromFieldId: string;
  toFieldId: string;
  fromTableId: string;
  toTableId: string;
  kind: FieldDependencyEdgeKind;
  /** For cross_record edges: which link field to use for dirty propagation */
  linkFieldId?: string;
  /** Semantic hint for debugging (does not affect propagation) */
  semantic?: FieldDependencyEdgeSemantic;
}

/**
 * Link relationship type.
 */
export type LinkRelationship = 'oneMany' | 'manyOne' | 'oneOne' | 'manyMany';

/**
 * Parsed lookup options (for lookup/rollup fields).
 */
export interface ParsedLookupOptions {
  linkFieldId: string;
  foreignTableId: string;
  lookupFieldId: string;
  /** Field IDs referenced in the lookup filter - changes to these fields should trigger recalculation */
  filterFieldIds?: string[];
  /** Original filter DTO for precise dirty propagation */
  filterDto?: unknown;
}

/**
 * Parsed link options (for link fields).
 */
export interface ParsedLinkOptions {
  foreignTableId: string;
  lookupFieldId: string;
  symmetricFieldId?: string;
  /** FK host table name (format: baseDbName.tableDbName) */
  fkHostTableName?: string;
  /** Link relationship type */
  relationship?: LinkRelationship;
}

/**
 * Metadata for conditional field options (conditionalRollup / conditionalLookup).
 * Unlike regular lookup/rollup, these don't have a linkFieldId.
 */
export interface ParsedConditionalOptions {
  foreignTableId: string;
  lookupFieldId: string;
  /** Field IDs referenced in the condition filter - changes to these fields should trigger recalculation */
  conditionFieldIds: string[];
  /** Original filter DTO for precise dirty propagation */
  filterDto?: unknown;
}

/**
 * Field metadata for dependency graph construction.
 */
export interface FieldMeta {
  id: string;
  tableId: string;
  type: string;
  isComputed: boolean;
  isLookup?: boolean;
  options: ParsedLinkOptions | null;
  lookupOptions: ParsedLookupOptions | null;
  /** For conditionalRollup/conditionalLookup fields */
  conditionalOptions: ParsedConditionalOptions | null;
}

/**
 * Result of loading field dependency graph data.
 */
export interface FieldDependencyGraphData {
  fieldsById: Map<string, FieldMeta>;
  edges: ReadonlyArray<FieldDependencyEdge>;
}

/**
 * Parser function signature for field options.
 */
export type OptionsParser<T> = (raw: string | null) => Result<T | null, DomainError>;
