import { type DomainError, type Table } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

import {
  TableQueryObservationWindow,
  type TableQueryRelationKind,
  type TableQueryRelationShape,
} from './domain';
import { buildQueryConfigShape, parseFilterStats } from './queryConfigShape';

export type RelationFieldConfigObservationInput = {
  readonly sourceTable: Table;
  readonly targetTable: Table;
  readonly fieldId: string;
  readonly spaceId?: string;
  readonly now: Date;
};

type FieldLike = ReturnType<Table['getFields']>[number];

type ConditionDto = {
  readonly filter?: unknown;
  readonly sort?: unknown;
  readonly limit?: number;
};

type RelationConfig = {
  readonly relationKind: TableQueryRelationKind;
  readonly targetTableId: string;
  readonly sourceFieldId: string;
  readonly targetLookupFieldId?: string;
  readonly condition?: ConditionDto;
  readonly filterByViewId?: string | null;
};

export const buildRelationFieldConfigObservation = (
  input: RelationFieldConfigObservationInput
): Result<TableQueryObservationWindow | undefined, DomainError> => {
  const field = input.sourceTable
    .getFields()
    .find((candidate) => candidate.id().toString() === input.fieldId);
  if (!field) return ok(undefined);

  const relation = extractRelationConfig(field);
  if (!relation || relation.targetTableId !== input.targetTable.id().toString()) {
    return ok(undefined);
  }

  const viewConfig = readTargetViewConfig(input.targetTable, relation.filterByViewId);
  const filter = mergeFilters(relation.condition?.filter, viewConfig.filter);
  const sort = relation.condition?.sort ?? viewConfig.sort;
  const filterStats = parseFilterStats(filter);
  const hasTargetFilter = Boolean(filterStats);
  const hasTargetSort = Boolean(sort);

  if (!hasTargetFilter && !hasTargetSort) return ok(undefined);

  const relationShape: TableQueryRelationShape = {
    relationKind: relation.relationKind,
    sourceTableId: input.sourceTable.id().toString(),
    targetTableId: input.targetTable.id().toString(),
    sourceFieldId: relation.sourceFieldId,
    targetLookupFieldId: relation.targetLookupFieldId,
    fieldReferenceCount: filterStats?.leaves.filter((leaf) => leaf.isFieldReference).length ?? 0,
    hasTargetFilter,
    hasTargetSort,
    limitBucket: bucketLimit(relation.condition?.limit),
  };

  const shape = buildQueryConfigShape({
    table: input.targetTable,
    filter,
    sort,
    relationShape,
  });
  if (shape.isErr()) return err(shape.error);
  if (!shape.value) return ok(undefined);

  return TableQueryObservationWindow.create({
    spaceId: input.spaceId,
    baseId: input.targetTable.baseId().toString(),
    tableId: input.targetTable.id().toString(),
    windowStart: floorDate(input.now, 300_000),
    windowSizeSeconds: 300,
    shape: shape.value,
    requestCount: 1,
    slowCount: 0,
    timeoutCount: 0,
    dbErrorCount: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    sqlDiagnostics: [
      {
        source: 'relation_field_config',
        statementKind: 'RELATION_FIELD_CONFIG',
        fingerprint: `relation_field_config:${relation.relationKind}:${input.sourceTable.id().toString()}:${relation.sourceFieldId}:${shape.value.shapeHash()}`,
        parameterCount: 0,
        sampled: false,
      },
    ],
  });
};

const extractRelationConfig = (field: FieldLike): RelationConfig | undefined => {
  const fieldType = field.type().toString();
  if (fieldType === 'conditionalLookup') return extractConditionalLookupConfig(field);
  if (fieldType === 'conditionalRollup') return extractConditionalRollupConfig(field);
  if (fieldType === 'lookup') return extractLookupConfig(field);
  if (fieldType === 'link') return extractLinkConfig(field);
  return undefined;
};

const extractConditionalLookupConfig = (field: FieldLike): RelationConfig | undefined => {
  const sourceFieldId = field.id().toString();
  const options = callNoArg<{
    foreignTableId(): { toString(): string };
    lookupFieldId(): { toString(): string };
    condition(): { toDto(): ConditionDto };
  }>(field, 'conditionalLookupOptions');
  if (!options) return undefined;
  return {
    relationKind: 'conditional_lookup',
    targetTableId: options.foreignTableId().toString(),
    sourceFieldId,
    targetLookupFieldId: options.lookupFieldId().toString(),
    condition: options.condition().toDto(),
  };
};

const extractConditionalRollupConfig = (field: FieldLike): RelationConfig | undefined => {
  const sourceFieldId = field.id().toString();
  const config = callNoArg<{
    foreignTableId(): { toString(): string };
    lookupFieldId(): { toString(): string };
    condition(): { toDto(): ConditionDto };
  }>(field, 'config');
  if (!config) return undefined;
  return {
    relationKind: 'conditional_rollup',
    targetTableId: config.foreignTableId().toString(),
    sourceFieldId,
    targetLookupFieldId: config.lookupFieldId().toString(),
    condition: config.condition().toDto(),
  };
};

const extractLookupConfig = (field: FieldLike): RelationConfig | undefined => {
  const sourceFieldId = field.id().toString();
  const options = callNoArg<{
    foreignTableId(): { toString(): string };
    lookupFieldId(): { toString(): string };
    condition(): { toDto(): ConditionDto } | undefined;
  }>(field, 'lookupOptions');
  if (!options) return undefined;
  const condition = options.condition();
  if (!condition) return undefined;
  return {
    relationKind: 'lookup',
    targetTableId: options.foreignTableId().toString(),
    sourceFieldId,
    targetLookupFieldId: options.lookupFieldId().toString(),
    condition: condition.toDto(),
  };
};

const extractLinkConfig = (field: FieldLike): RelationConfig | undefined => {
  const sourceFieldId = field.id().toString();
  const config = callNoArg<{
    foreignTableId(): { toString(): string };
    lookupFieldId(): { toString(): string };
    filter(): unknown;
    filterByViewId(): { toString(): string } | null | undefined;
  }>(field, 'config');
  if (!config) return undefined;
  return {
    relationKind: 'link',
    targetTableId: config.foreignTableId().toString(),
    sourceFieldId,
    targetLookupFieldId: config.lookupFieldId().toString(),
    condition: { filter: config.filter() },
    filterByViewId: config.filterByViewId() === null ? null : config.filterByViewId()?.toString(),
  };
};

const readTargetViewConfig = (
  targetTable: Table,
  viewId: string | null | undefined
): { readonly filter?: unknown; readonly sort?: unknown } => {
  if (!viewId) return {};
  const view = targetTable.getViewById(viewId);
  if (view.isErr()) return {};
  const defaults = view.value.queryDefaults();
  if (defaults.isErr()) return {};
  return {
    filter: defaults.value.filter(),
    sort: defaults.value.sort(),
  };
};

const mergeFilters = (left: unknown, right: unknown): unknown => {
  const leftFilter = normalizeFilter(left);
  const rightFilter = normalizeFilter(right);
  if (!leftFilter) return rightFilter;
  if (!rightFilter) return leftFilter;
  return {
    conjunction: 'and',
    filterSet: [leftFilter, rightFilter],
  };
};

const normalizeFilter = (filter: unknown): Record<string, unknown> | undefined => {
  if (!filter) return undefined;
  if (typeof filter === 'object' && !Array.isArray(filter))
    return filter as Record<string, unknown>;
  if (typeof filter !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(filter);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const bucketLimit = (limit: number | undefined): 'none' | 'small' | 'medium' | 'large' => {
  if (!limit) return 'none';
  if (limit <= 10) return 'small';
  if (limit <= 100) return 'medium';
  return 'large';
};

const callNoArg = <T>(target: unknown, method: string): T | undefined => {
  if (!target || typeof target !== 'object') return undefined;
  const candidate = (target as Record<string, unknown>)[method];
  return typeof candidate === 'function' ? (candidate.call(target) as T) : undefined;
};

const floorDate = (date: Date, windowMs: number): Date =>
  new Date(Math.floor(date.getTime() / windowMs) * windowMs);
