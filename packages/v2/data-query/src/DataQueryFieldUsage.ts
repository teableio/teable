import { isRecordFilterFieldReferenceValue } from '@teable/v2-core';

import type { DataQueryDefinitionInput, DataQueryFieldUsage, DataQueryFilter } from './types';

/**
 * Canonical usage order so every caller that reports the same dependency renders
 * it identically: byte-stable across runs and between the binding and the
 * offline manifest index.
 */
const usageOrder: ReadonlyArray<DataQueryFieldUsage> = [
  'projection',
  'filter',
  'sort',
  'group',
  'aggregate',
  'reference',
  'relation',
];

export const sortDataQueryFieldUsages = (
  usages: Iterable<DataQueryFieldUsage>
): DataQueryFieldUsage[] => {
  const present = new Set(usages);
  return usageOrder.filter((usage) => present.has(usage));
};

type UsageRecorder = (fieldId: string, usage: DataQueryFieldUsage) => void;

/**
 * A field-to-field predicate names a second field. Only an unqualified
 * reference, or one qualified with this definition's own table, reads a column
 * of the queried table; a foreign-qualified reference is rejected by the core
 * filter spec ("Filter field table mismatch") and must never be attributed to
 * the source table.
 */
const isLocalFieldReference = (
  value: unknown,
  tableId: string
): value is { type: 'field'; fieldId: string } =>
  isRecordFilterFieldReferenceValue(value) &&
  (value.tableId === undefined || value.tableId === tableId);

const recordFilterUsages = (
  node: DataQueryFilter,
  tableId: string,
  record: UsageRecorder
): void => {
  if ('items' in node) {
    for (const item of node.items) recordFilterUsages(item, tableId, record);
    return;
  }
  if ('not' in node) {
    recordFilterUsages(node.not, tableId, record);
    return;
  }
  record(node.fieldId, 'filter');
  // Parameter references resolve to literals or dates, never to field references.
  if (isLocalFieldReference(node.value, tableId)) record(node.value.fieldId, 'reference');
};

const recordSourceUsages = (definition: DataQueryDefinitionInput, record: UsageRecorder): void => {
  if (definition.kind === 'records') {
    for (const projection of definition.select) {
      if ('fieldId' in projection) record(projection.fieldId, 'projection');
    }
    return;
  }
  for (const group of definition.groupBy ?? []) record(group.fieldId, 'group');
  for (const aggregate of definition.aggregates) record(aggregate.fieldId, 'aggregate');
};

/**
 * Aggregate alias sorting names an output, not a field, and system columns are
 * not fields, so neither becomes a dependency. Every allow-listed target of a
 * parameterized sort does, even when the runtime parameter selects only one.
 */
const recordSortUsages = (
  sort: NonNullable<DataQueryDefinitionInput['sort']>,
  record: UsageRecorder
): void => {
  for (const item of sort) {
    if ('fieldId' in item) {
      record(item.fieldId, 'sort');
      continue;
    }
    if (!('field' in item)) continue;
    for (const target of item.allowed) {
      if ('fieldId' in target) record(target.fieldId, 'sort');
    }
  }
};

/**
 * The single walker for every field a definition declares, keyed by field id in
 * first-appearance order. Callers own rendering: the manifest index sorts by
 * field id, the binding keeps declared order.
 */
export const collectDataQueryFieldUsages = (
  definition: DataQueryDefinitionInput
): Map<string, Set<DataQueryFieldUsage>> => {
  const usages = new Map<string, Set<DataQueryFieldUsage>>();
  const record: UsageRecorder = (fieldId, usage) => {
    const current = usages.get(fieldId) ?? new Set<DataQueryFieldUsage>();
    current.add(usage);
    usages.set(fieldId, current);
  };
  recordSourceUsages(definition, record);
  if (definition.sort) recordSortUsages(definition.sort, record);
  if (definition.filter) recordFilterUsages(definition.filter, definition.tableId, record);
  return usages;
};

/**
 * Source-qualified view of the same walk, for v2 relation manifests. `root`
 * always exists, even when the definition only reads system columns.
 */
export const collectDataQuerySourceFieldUsages = (
  definition: DataQueryDefinitionInput
): Map<string, Map<string, Set<DataQueryFieldUsage>>> => {
  const sources = new Map<string, Map<string, Set<DataQueryFieldUsage>>>();
  const record = (source: string, fieldId: string, usage: DataQueryFieldUsage): void => {
    const usages = sources.get(source) ?? new Map<string, Set<DataQueryFieldUsage>>();
    const fieldUsages = usages.get(fieldId) ?? new Set<DataQueryFieldUsage>();
    fieldUsages.add(usage);
    usages.set(fieldId, fieldUsages);
    sources.set(source, usages);
  };
  const sourceOf = (projection: object): string => {
    if ('source' in projection && typeof projection.source === 'string') {
      return projection.source;
    }
    return 'root';
  };
  if (definition.kind === 'records') {
    for (const projection of definition.select) {
      if ('fieldId' in projection) {
        record(sourceOf(projection), projection.fieldId, 'projection');
      }
    }
  } else {
    for (const group of definition.groupBy ?? []) {
      record(sourceOf(group), group.fieldId, 'group');
    }
    for (const aggregate of definition.aggregates) {
      record('root', aggregate.fieldId, 'aggregate');
    }
  }
  const rootRecord: UsageRecorder = (fieldId, usage) => record('root', fieldId, usage);
  if (definition.sort) recordSortUsages(definition.sort, rootRecord);
  if (definition.filter) recordFilterUsages(definition.filter, definition.tableId, rootRecord);
  if (definition.version === 2) {
    for (const relation of Object.values(definition.relations ?? {})) {
      record('root', relation.linkFieldId, 'relation');
    }
  }
  return sources;
};
