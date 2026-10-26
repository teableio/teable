// oxlint-disable sonarjs/cognitive-complexity -- one branch per projection kind or usage source
import { isRecordFilterFieldReferenceValue } from '@teable/v2-core';

import type {
  DataQueryDefinitionInput,
  DataQueryFieldUsage,
  DataQueryFilter,
  DataQuerySortTarget,
} from './types';

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

// oxlint-disable-next-line sonarjs/cognitive-complexity -- one branch per projection kind
const recordSourceUsages = (definition: DataQueryDefinitionInput, record: UsageRecorder): void => {
  if (definition.kind === 'records') {
    for (const projection of definition.select) {
      if ('statisticFunc' in projection) {
        if (projection.fieldId !== undefined) record(projection.fieldId, 'aggregate');
        continue;
      }
      if ('fieldId' in projection) record(projection.fieldId, 'projection');
    }
    return;
  }
  for (const group of definition.groupBy ?? []) record(group.fieldId, 'group');
  for (const aggregate of definition.aggregates) {
    // A relation metric reads its target field; this walk has no source map.
    if (aggregate.fieldId !== undefined) record(aggregate.fieldId, 'aggregate');
  }
};

/**
 * Aggregate alias sorting names an output, not a field, and system columns are
 * not fields, so neither becomes a dependency. Every allow-listed target of a
 * parameterized sort does, even when the runtime parameter selects only one.
 */
const recordSortTarget = (
  target: DataQuerySortTarget,
  record: (source: string, fieldId: string, usage: DataQueryFieldUsage) => void
): void => {
  if ('fieldId' in target) {
    record('source' in target ? target.source : 'root', target.fieldId, 'sort');
  }
};

const recordSortUsages = (
  sort: NonNullable<DataQueryDefinitionInput['sort']>,
  record: (source: string, fieldId: string, usage: DataQueryFieldUsage) => void
): void => {
  for (const item of sort) {
    if ('fieldId' in item) {
      recordSortTarget(item, record);
      continue;
    }
    if ('field' in item) {
      for (const target of item.allowed) recordSortTarget(target, record);
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
  if (definition.sort) {
    recordSortUsages(definition.sort, (_source, fieldId, usage) => record(fieldId, usage));
  }
  if (definition.filter) recordFilterUsages(definition.filter, definition.tableId, record);
  if (definition.version === 2) {
    for (const relation of Object.values(definition.relations ?? {})) {
      if (relation.filter) {
        recordFilterUsages(relation.filter, relation.tableId, record);
      }
    }
  }
  return usages;
};

type SourceUsageRecorder = (source: string, fieldId: string, usage: DataQueryFieldUsage) => void;

const recordRelationSourceUsages = (
  definition: DataQueryDefinitionInput,
  record: SourceUsageRecorder
): void => {
  if (definition.version !== 2) return;
  for (const [alias, relation] of Object.entries(definition.relations ?? {})) {
    // A multi-hop link is a field of the table it is declared on, not of the root.
    record(relation.via ?? 'root', relation.linkFieldId, 'relation');
    if (!relation.filter) continue;
    recordFilterUsages(relation.filter, relation.tableId, (fieldId, usage) =>
      record(alias, fieldId, usage)
    );
  }
};

/**
 * Source-qualified view of the same walk, for v2 relation manifests. `root`
 * always exists, even when the definition only reads system columns.
 */

// oxlint-disable-next-line sonarjs/cognitive-complexity -- one walk over every source-qualified usage
// eslint-disable-next-line sonarjs/cognitive-complexity -- one walk over every source-qualified usage
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
      if ('statisticFunc' in projection) {
        if (projection.fieldId !== undefined) {
          record(sourceOf(projection), projection.fieldId, 'aggregate');
        }
        continue;
      }
      if ('fieldId' in projection) {
        record(sourceOf(projection), projection.fieldId, 'projection');
      }
    }
  } else {
    for (const group of definition.groupBy ?? []) {
      record(sourceOf(group), group.fieldId, 'group');
    }
    for (const aggregate of definition.aggregates) {
      if (aggregate.fieldId === undefined) continue;
      record(sourceOf(aggregate), aggregate.fieldId, 'aggregate');
    }
  }
  const rootRecord: UsageRecorder = (fieldId, usage) => record('root', fieldId, usage);
  if (definition.sort) recordSortUsages(definition.sort, record);
  if (definition.filter) recordFilterUsages(definition.filter, definition.tableId, rootRecord);
  recordRelationSourceUsages(definition, record);
  return sources;
};
