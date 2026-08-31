/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/cognitive-complexity */
import { CellValueType, FieldType, isMeTag } from '@teable/core';
import {
  domainError,
  type DomainError,
  type RecordFilter,
  type RecordFilterDateValue,
  type RecordFilterGroup,
  type RecordFilterNode,
  type RecordFilterOperator,
  type RecordFilterValue,
} from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

export interface IRecordFilterFieldMeta {
  readonly type: string;
  readonly cellValueType?: string;
  readonly options?: unknown;
}

const v1SymbolOperatorMap: Readonly<Record<string, string>> = {
  '=': 'is',
  '!=': 'isNot',
  '>': 'isGreater',
  '>=': 'isGreaterEqual',
  '<': 'isLess',
  '<=': 'isLessEqual',
  LIKE: 'contains',
  'NOT LIKE': 'doesNotContain',
  IN: 'isAnyOf',
  'NOT IN': 'isNoneOf',
  HAS: 'hasAllOf',
  'IS NULL': 'isEmpty',
  'IS NOT NULL': 'isNotEmpty',
  'IS WITH IN': 'isWithIn',
};

const dateComparisonOperators: ReadonlySet<RecordFilterOperator> = new Set([
  'is',
  'isNot',
  'isBefore',
  'isAfter',
  'isOnOrBefore',
  'isOnOrAfter',
]);

const dateFilterFieldTypes: ReadonlySet<string> = new Set([
  FieldType.Date,
  FieldType.CreatedTime,
  FieldType.LastModifiedTime,
]);

const operatorsExpectingNull: ReadonlySet<RecordFilterOperator> = new Set([
  'isEmpty',
  'isNotEmpty',
]);

const operatorsExpectingArray: ReadonlySet<RecordFilterOperator> = new Set([
  'isAnyOf',
  'isNoneOf',
  'hasAnyOf',
  'hasAllOf',
  'isNotExactly',
  'hasNoneOf',
  'isExactly',
]);

type LegacyFilterGroup = {
  readonly conjunction: 'and' | 'or';
  readonly filterSet: ReadonlyArray<unknown>;
};

type LegacyFilterItem = {
  readonly fieldId: string;
  readonly operator: string;
  readonly value?: unknown;
  readonly isSymbol?: boolean;
};

const isRecordFilterFieldReferenceValue = (
  value: unknown
): value is { fieldId: string; type: 'field' } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.type === 'field' && typeof record.fieldId === 'string';
};

const isV2FilterNode = (value: unknown): value is RecordFilterNode => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.items)) return true;
  if (record.not && typeof record.not === 'object') return true;
  return typeof record.fieldId === 'string' && typeof record.operator === 'string';
};

const isV1FilterGroup = (value: unknown): value is LegacyFilterGroup => {
  if (!value || typeof value !== 'object') return false;
  return Array.isArray((value as Record<string, unknown>).filterSet);
};

const isV1FilterItem = (value: unknown): value is LegacyFilterItem => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.fieldId === 'string' && typeof record.operator === 'string';
};

const normalizeV1Operator = (operator: string): RecordFilterOperator =>
  (v1SymbolOperatorMap[operator] ?? operator) as RecordFilterOperator;

const mapLegacyDateRangeCondition = (
  fieldId: string,
  operator: RecordFilterOperator,
  value: unknown
): Result<RecordFilterNode | null, DomainError> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ok(null);

  const record = value as Record<string, unknown>;
  if (record.mode !== 'dateRange') return ok(null);

  if (operator !== 'is' && operator !== 'isWithIn') {
    // v1 parity: unsupported operator + dateRange is skipped by the engine, not
    // an error — fall through to the plain mapping; the v2 condition visitor
    // compiles it to a no-op TRUE fragment.
    return ok(null);
  }

  const exactDate = record.exactDate;
  const exactDateEnd = record.exactDateEnd;
  const timeZone = record.timeZone;
  if (
    typeof exactDate !== 'string' ||
    typeof exactDateEnd !== 'string' ||
    typeof timeZone !== 'string'
  ) {
    return ok(null);
  }

  const startTimestamp = Date.parse(exactDate);
  const endTimestamp = Date.parse(exactDateEnd);
  if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp)) {
    return ok(null);
  }
  if (startTimestamp > endTimestamp) {
    // v1 parity: an inverted range is skipped by the engine, not an error —
    // fall through to the plain mapping; the v2 condition visitor compiles it
    // to a no-op TRUE fragment.
    return ok(null);
  }

  return ok({
    conjunction: 'and',
    items: [
      {
        fieldId,
        operator: 'isOnOrAfter',
        value: {
          mode: 'exactDate',
          exactDate,
          timeZone,
        } as RecordFilterDateValue,
      },
      {
        fieldId,
        operator: 'isOnOrBefore',
        value: {
          mode: 'exactDate',
          exactDate: exactDateEnd,
          timeZone,
        } as RecordFilterDateValue,
      },
    ],
  });
};

const normalizeV2FilterNode = (
  filter: RecordFilterNode
): Result<RecordFilterNode | null, DomainError> => {
  if ('not' in filter) {
    return normalizeV2FilterNode(filter.not).map((next) => (next ? { not: next } : null));
  }

  if ('items' in filter) {
    const items: RecordFilterNode[] = [];
    for (const item of filter.items) {
      const normalized = normalizeV2FilterNode(item);
      if (normalized.isErr()) return err(normalized.error);
      if (normalized.value) items.push(normalized.value);
    }
    return ok(items.length ? { conjunction: filter.conjunction, items } : null);
  }

  const operator = filter.operator as RecordFilterOperator;
  const value = filter.value as RecordFilterValue;
  const legacyDateRangeCondition = mapLegacyDateRangeCondition(filter.fieldId, operator, value);
  if (legacyDateRangeCondition.isErr()) return err(legacyDateRangeCondition.error);
  if (legacyDateRangeCondition.value) return ok(legacyDateRangeCondition.value);

  if (operatorsExpectingNull.has(operator)) {
    return ok(value === null ? filter : null);
  }

  if (operatorsExpectingArray.has(operator)) {
    if (value == null || (Array.isArray(value) && value.length === 0)) return ok(null);
    return ok(filter);
  }

  if (value == null) {
    return ok(
      operator === 'is' || operator === 'isNot'
        ? { fieldId: filter.fieldId, operator, value: null }
        : null
    );
  }
  return ok(filter);
};

const mapV1FilterItem = (
  filter: LegacyFilterItem
): Result<RecordFilterNode | null, DomainError> => {
  const operator = normalizeV1Operator(filter.operator);
  const rawValue = 'value' in filter ? filter.value : null;
  const legacyDateRangeCondition = mapLegacyDateRangeCondition(filter.fieldId, operator, rawValue);
  if (legacyDateRangeCondition.isErr()) return err(legacyDateRangeCondition.error);
  if (legacyDateRangeCondition.value) return ok(legacyDateRangeCondition.value);

  if (operatorsExpectingNull.has(operator)) {
    return ok({ fieldId: filter.fieldId, operator, value: null });
  }

  if (operatorsExpectingArray.has(operator)) {
    let value = rawValue;
    if (value == null) return ok(null);
    if (!Array.isArray(value) && !isRecordFilterFieldReferenceValue(value)) {
      value = [value];
    }
    if (Array.isArray(value) && value.length === 0) return ok(null);
    return ok({
      fieldId: filter.fieldId,
      operator,
      value: value as RecordFilterValue,
    });
  }

  if (rawValue == null) {
    return ok(
      operator === 'is' || operator === 'isNot'
        ? { fieldId: filter.fieldId, operator, value: null }
        : null
    );
  }

  return ok({
    fieldId: filter.fieldId,
    operator,
    value: rawValue as RecordFilterValue,
  });
};

const mapFilterEntry = (entry: unknown): Result<RecordFilterNode | null, DomainError> => {
  if (entry == null) return ok(null);
  if (isV1FilterGroup(entry)) return mapV1FilterGroup(entry);
  if (isV1FilterItem(entry)) return mapV1FilterItem(entry);
  if (isV2FilterNode(entry)) return normalizeV2FilterNode(entry);
  return ok(null);
};

const mapV1FilterGroup = (
  filter: LegacyFilterGroup
): Result<RecordFilterGroup | null, DomainError> => {
  const items: RecordFilterNode[] = [];
  for (const entry of filter.filterSet) {
    const mapped = mapFilterEntry(entry);
    if (mapped.isErr()) return err(mapped.error);
    if (mapped.value) items.push(mapped.value);
  }
  return ok(
    items.length
      ? {
          conjunction: filter.conjunction === 'or' ? 'or' : 'and',
          items,
        }
      : null
  );
};

const mapFilter = (filter: unknown): Result<RecordFilter | undefined | null, DomainError> => {
  if (filter === undefined) return ok(undefined);
  if (filter === null) return ok(null);
  if (isV1FilterGroup(filter)) return mapV1FilterGroup(filter);
  if (isV1FilterItem(filter)) return mapV1FilterItem(filter);
  if (isV2FilterNode(filter)) return normalizeV2FilterNode(filter);
  return ok(undefined);
};

const extractTimeZone = (options: unknown): string => {
  if (!options || typeof options !== 'object' || !('formatting' in options)) return 'utc';
  const formatting = options.formatting;
  if (!formatting || typeof formatting !== 'object' || !('timeZone' in formatting)) return 'utc';
  return typeof formatting.timeZone === 'string' ? formatting.timeZone : 'utc';
};

const isDateFilterField = (fieldMeta: IRecordFilterFieldMeta): boolean =>
  dateFilterFieldTypes.has(fieldMeta.type) || fieldMeta.cellValueType === CellValueType.DateTime;

const normalizeLegacyDateComparisonValue = (
  fieldMeta: IRecordFilterFieldMeta | undefined,
  operator: RecordFilterOperator,
  value: RecordFilterValue
): RecordFilterValue => {
  if (!fieldMeta || !dateComparisonOperators.has(operator) || !isDateFilterField(fieldMeta)) {
    return value;
  }
  if (isRecordFilterFieldReferenceValue(value) || Array.isArray(value)) {
    return value;
  }
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return value;
  }

  return {
    mode: 'exactDate',
    exactDate: value,
    timeZone: extractTimeZone(fieldMeta.options),
  } as RecordFilterDateValue;
};

const normalizeMappedNode = (
  node: RecordFilterNode,
  fieldMetaById: ReadonlyMap<string, IRecordFilterFieldMeta>,
  currentUserId?: string
): RecordFilterNode | null => {
  if ('not' in node) {
    const next = normalizeMappedNode(node.not, fieldMetaById, currentUserId);
    return next ? { not: next } : null;
  }

  if ('items' in node) {
    const items = node.items
      .map((item) => normalizeMappedNode(item, fieldMetaById, currentUserId))
      .filter((item): item is RecordFilterNode => Boolean(item));
    return items.length ? { conjunction: node.conjunction, items } : null;
  }

  const operator = node.operator as RecordFilterOperator;
  const fieldMeta = fieldMetaById.get(node.fieldId);
  let value = node.value as RecordFilterValue;

  if (operatorsExpectingNull.has(operator)) {
    return value === null ? { ...node, value: null } : null;
  }

  if (value == null) {
    const isCheckboxField =
      fieldMeta?.type === FieldType.Checkbox || fieldMeta?.cellValueType === CellValueType.Boolean;
    if (!isCheckboxField) return null;
    // v1 stores unchecked as is+null and checked as isNot+null; boolean condition
    // specs only accept `is`, so isNot+null must become is+true (checked).
    if (operator === 'is') return { ...node, operator: 'is', value: false };
    if (operator === 'isNot') return { ...node, operator: 'is', value: true };
    return null;
  }

  if (
    currentUserId &&
    fieldMeta &&
    [FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy].includes(
      fieldMeta.type as FieldType
    )
  ) {
    if (Array.isArray(value)) {
      value = value.map((entry) =>
        typeof entry === 'string' && isMeTag(entry) ? currentUserId : entry
      ) as RecordFilterValue;
    } else if (typeof value === 'string' && isMeTag(value)) {
      value = currentUserId;
    }
  }

  value = normalizeLegacyDateComparisonValue(fieldMeta, operator, value);

  if (operatorsExpectingArray.has(operator)) {
    if (
      !Array.isArray(value) &&
      !isRecordFilterFieldReferenceValue(value) &&
      typeof value !== 'object'
    ) {
      value = [value];
    }
    if (Array.isArray(value) && value.length === 0) return null;
  }

  return { ...node, value };
};

export const normalizeLegacyRecordFilterForV2 = (
  filter: unknown,
  fieldMetaById: ReadonlyMap<string, IRecordFilterFieldMeta>,
  currentUserId?: string
): Result<RecordFilter | undefined | null, DomainError> =>
  mapFilter(filter).map((mapped) => {
    if (!mapped) return mapped;
    return normalizeMappedNode(mapped, fieldMetaById, currentUserId) ?? undefined;
  });
