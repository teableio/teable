import type {
  FieldDependencyEdge,
  FieldMeta,
  ParsedConditionalOptions,
  ParsedLinkOptions,
  ParsedLookupOptions,
} from './types';

/**
 * Build dependency edges for a lookup field.
 *
 * Creates two edges:
 * 1. lookup_link: dependency on the link field (same-record)
 * 2. lookup_source: dependency on the source field in foreign table (cross-record)
 */
export const buildLookupEdges = (
  fieldId: string,
  tableId: string,
  options: ParsedLookupOptions
): FieldDependencyEdge[] => {
  return [
    // Dependency on the link field (same-record)
    {
      fromFieldId: options.linkFieldId,
      toFieldId: fieldId,
      fromTableId: tableId,
      toTableId: tableId,
      kind: 'same_record',
      semantic: 'lookup_link',
    },
    // Dependency on the source field in foreign table (cross-record)
    {
      fromFieldId: options.lookupFieldId,
      toFieldId: fieldId,
      fromTableId: options.foreignTableId,
      toTableId: tableId,
      kind: 'cross_record',
      linkFieldId: options.linkFieldId,
      semantic: 'lookup_source',
    },
  ];
};

/**
 * Build dependency edges for a rollup field.
 *
 * Creates two edges:
 * 1. lookup_link: dependency on the link field (same-record)
 * 2. rollup_source: dependency on the source field in foreign table (cross-record)
 */
export const buildRollupEdges = (
  fieldId: string,
  tableId: string,
  options: ParsedLookupOptions
): FieldDependencyEdge[] => {
  return [
    // Dependency on the link field (same-record)
    {
      fromFieldId: options.linkFieldId,
      toFieldId: fieldId,
      fromTableId: tableId,
      toTableId: tableId,
      kind: 'same_record',
      semantic: 'lookup_link',
    },
    // Dependency on the source field in foreign table (cross-record)
    {
      fromFieldId: options.lookupFieldId,
      toFieldId: fieldId,
      fromTableId: options.foreignTableId,
      toTableId: tableId,
      kind: 'cross_record',
      linkFieldId: options.linkFieldId,
      semantic: 'rollup_source',
    },
  ];
};

/**
 * Build dependency edges for a link field.
 *
 * Creates one edge:
 * 1. link_title: dependency on the lookup field in foreign table (cross-record)
 */
export const buildLinkEdges = (
  fieldId: string,
  tableId: string,
  options: ParsedLinkOptions
): FieldDependencyEdge[] => {
  return [
    // Dependency on the lookup field in foreign table (for display title)
    {
      fromFieldId: options.lookupFieldId,
      toFieldId: fieldId,
      fromTableId: options.foreignTableId,
      toTableId: tableId,
      kind: 'cross_record',
      linkFieldId: fieldId, // The link field itself is used for propagation
      semantic: 'link_title',
    },
  ];
};

/**
 * Build dependency edges for a conditional field (conditionalRollup/conditionalLookup).
 *
 * Creates edges for:
 * 1. The lookup field (cross-record)
 * 2. Each condition field (cross-record)
 */
export const buildConditionalEdges = (
  fieldId: string,
  tableId: string,
  fieldType: string,
  options: ParsedConditionalOptions
): FieldDependencyEdge[] => {
  const semantic =
    fieldType === 'conditionalRollup' ? 'conditional_rollup_source' : 'conditional_lookup_source';

  const edges: FieldDependencyEdge[] = [
    // Dependency on the lookup field in foreign table
    {
      fromFieldId: options.lookupFieldId,
      toFieldId: fieldId,
      fromTableId: options.foreignTableId,
      toTableId: tableId,
      kind: 'cross_record',
      semantic,
    },
  ];

  // Add edges for each condition field
  for (const conditionFieldId of options.conditionFieldIds) {
    // Skip if the condition field is the same as the lookup field (already added)
    if (conditionFieldId === options.lookupFieldId) continue;

    edges.push({
      fromFieldId: conditionFieldId,
      toFieldId: fieldId,
      fromTableId: options.foreignTableId,
      toTableId: tableId,
      kind: 'cross_record',
      semantic,
    });
  }

  return edges;
};

/**
 * Build derived edges from field metadata.
 * These are edges that are not stored in the reference table but
 * are derived from field configuration.
 */
export const buildDerivedEdgesFromField = (field: FieldMeta): FieldDependencyEdge[] => {
  const { id: fieldId, tableId, type, lookupOptions, options, conditionalOptions } = field;

  // Lookup field
  if (type === 'lookup' && lookupOptions) {
    return buildLookupEdges(fieldId, tableId, lookupOptions);
  }

  // Rollup field
  if (type === 'rollup' && lookupOptions) {
    return buildRollupEdges(fieldId, tableId, lookupOptions);
  }

  // Link field
  if (type === 'link' && options) {
    return buildLinkEdges(fieldId, tableId, options);
  }

  // Conditional fields
  if ((type === 'conditionalRollup' || type === 'conditionalLookup') && conditionalOptions) {
    return buildConditionalEdges(fieldId, tableId, type, conditionalOptions);
  }

  return [];
};

/**
 * Build derived edges from a list of fields.
 */
export const buildDerivedEdges = (fields: ReadonlyArray<FieldMeta>): FieldDependencyEdge[] => {
  const edges: FieldDependencyEdge[] = [];
  for (const field of fields) {
    edges.push(...buildDerivedEdgesFromField(field));
  }
  return edges;
};

/**
 * Merge reference edges and derived edges, removing duplicates.
 * Derived edges take priority over reference edges when there are conflicts.
 */
export const mergeEdges = (
  referenceEdges: ReadonlyArray<FieldDependencyEdge>,
  derivedEdges: ReadonlyArray<FieldDependencyEdge>
): ReadonlyArray<FieldDependencyEdge> => {
  const map = new Map<string, FieldDependencyEdge>();
  const add = (edge: FieldDependencyEdge) => {
    // Key includes kind and linkFieldId to distinguish different propagation paths
    const linkKey = edge.linkFieldId ?? '';
    const key = `${edge.fromFieldId}|${edge.toFieldId}|${edge.kind}|${linkKey}`;
    if (!map.has(key)) {
      map.set(key, edge);
    }
  };
  // Process derived edges FIRST so they take priority over reference edges.
  // Derived edges have more specific semantics (e.g., lookup_link vs formula_ref).
  derivedEdges.forEach(add);
  referenceEdges.forEach(add);
  return [...map.values()];
};
