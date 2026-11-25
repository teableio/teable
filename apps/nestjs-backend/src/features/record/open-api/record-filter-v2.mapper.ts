/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/cognitive-complexity */
import {
  CellValueType,
  extractFieldIdsFromFilter,
  FieldType,
  getFilterOperatorMapping,
  isMeTag,
} from '@teable/core';
import type { IFilterSet } from '@teable/core';
import {
  ConditionalLookupField,
  type CreatedTimeField,
  domainError,
  type DomainError,
  FieldType as V2FieldType,
  FieldValueTypeVisitor,
  isDateField,
  type ITableReadModel,
  type LastModifiedTimeField,
  LookupField,
  normalizeSavedViewCondition,
  type RecordFilter,
  type RecordFilterDateValue,
  type RecordFilterGroup,
  type RecordFilterNode,
  type RecordFilterOperator,
  type RecordFilterValue,
} from '@teable/v2-core';
import { err, ok, safeTry, type Result } from 'neverthrow';

export interface IRecordFilterFieldMeta {
  readonly type: string;
  readonly cellValueType?: string;
  readonly isMultipleCellValue?: boolean;
  readonly options?: unknown;
}

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

/**
 * v1 stores symbol operators (`=`, `IN`, `>`); the matching v2 operator depends on the
 * field type — a multi-select `=` is `isExactly`, not `is`, and a date `>` is `isAfter`,
 * not `isGreater`. Reverse `getFilterOperatorMapping` exactly like v1's
 * `getConvertedOperator`. An unknown field or a symbol its type does not offer must fail
 * loudly: silently keeping the unconverted symbol drops the condition in the v2 visitor.
 */
const convertSymbolOperator = (
  fieldId: string,
  fieldMeta: IRecordFilterFieldMeta | undefined,
  symbol: string
): Result<RecordFilterOperator, DomainError> => {
  if (!fieldMeta?.cellValueType) {
    return err(
      domainError.validation({
        message: `Cannot convert symbol filter operator '${symbol}' for field '${fieldId}': field type metadata is missing`,
        details: { fieldId, operator: symbol },
      })
    );
  }
  const mapping = getFilterOperatorMapping({
    type: fieldMeta.type as FieldType,
    cellValueType: fieldMeta.cellValueType as CellValueType,
    isMultipleCellValue: fieldMeta.isMultipleCellValue,
  });
  const operator = Object.entries(mapping).find(([, candidate]) => candidate === symbol)?.[0];
  if (!operator) {
    return err(
      domainError.validation({
        message: `Filter operator '${symbol}' is not supported by field type '${fieldMeta.type}'`,
        details: { fieldId, fieldType: fieldMeta.type, operator: symbol },
      })
    );
  }
  return ok(operator as RecordFilterOperator);
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
  filter: LegacyFilterItem,
  fieldMeta?: IRecordFilterFieldMeta,
  operatorOverride?: RecordFilterOperator
): Result<RecordFilterNode | null, DomainError> => {
  let operator: RecordFilterOperator;
  if (operatorOverride) {
    operator = operatorOverride;
  } else if (filter.isSymbol) {
    const converted = convertSymbolOperator(filter.fieldId, fieldMeta, filter.operator);
    if (converted.isErr()) return err(converted.error);
    operator = converted.value;
  } else {
    operator = filter.operator as RecordFilterOperator;
  }
  const rawValue = 'value' in filter ? filter.value : null;

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

const mapFilterEntry = (
  entry: unknown,
  fieldMetaById: ReadonlyMap<string, IRecordFilterFieldMeta>
): Result<RecordFilterNode | null, DomainError> => {
  if (entry == null) return ok(null);
  if (isV1FilterGroup(entry)) return mapV1FilterGroup(entry, fieldMetaById);
  if (isV1FilterItem(entry)) {
    return mapV1FilterItem(entry, fieldMetaById.get(entry.fieldId));
  }
  if (isV2FilterNode(entry)) return normalizeV2FilterNode(entry);
  return ok(null);
};

const mapV1FilterGroup = (
  filter: LegacyFilterGroup,
  fieldMetaById: ReadonlyMap<string, IRecordFilterFieldMeta>
): Result<RecordFilterGroup | null, DomainError> => {
  const items: RecordFilterNode[] = [];
  for (const entry of filter.filterSet) {
    const mapped = mapFilterEntry(entry, fieldMetaById);
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

const mapFilter = (
  filter: unknown,
  fieldMetaById: ReadonlyMap<string, IRecordFilterFieldMeta>
): Result<RecordFilter | undefined | null, DomainError> => {
  if (filter === undefined) return ok(undefined);
  if (filter === null) return ok(null);
  if (isV1FilterGroup(filter)) return mapV1FilterGroup(filter, fieldMetaById);
  if (isV1FilterItem(filter)) {
    return mapV1FilterItem(filter, fieldMetaById.get(filter.fieldId));
  }
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

const emptyStringDateOperator: Readonly<Record<string, RecordFilterOperator>> = {
  is: 'isEmpty',
  isNot: 'isNotEmpty',
};

/**
 * A date cell cannot hold the empty string, so `{date} = ""` / `{date} != ""`
 * means "is empty" / "is not empty". Forwarding the literal would compare a
 * timestamptz column against "" and fail with PostgreSQL 22007.
 */
export const normalizeEmptyDateComparison = (
  fieldMeta: IRecordFilterFieldMeta | undefined,
  operator: RecordFilterOperator,
  value: RecordFilterValue
): { operator: RecordFilterOperator; value: null } | undefined => {
  if (!fieldMeta || !isDateFilterField(fieldMeta) || value !== '') return undefined;
  const emptyOperator = emptyStringDateOperator[operator];
  return emptyOperator ? { operator: emptyOperator, value: null } : undefined;
};

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
  currentUserId?: string,
  source: 'query' | 'savedView' = 'query'
): RecordFilterNode | null => {
  if ('not' in node) {
    const next = normalizeMappedNode(node.not, fieldMetaById, currentUserId, source);
    return next ? { not: next } : null;
  }

  if ('items' in node) {
    const items = node.items
      .map((item) => normalizeMappedNode(item, fieldMetaById, currentUserId, source))
      .filter((item): item is RecordFilterNode => Boolean(item));
    return items.length ? { conjunction: node.conjunction, items } : null;
  }

  const operator = node.operator as RecordFilterOperator;
  const fieldMeta = fieldMetaById.get(node.fieldId);
  let value = node.value as RecordFilterValue;

  const emptyDateComparison = normalizeEmptyDateComparison(fieldMeta, operator, value);
  if (emptyDateComparison) {
    return { fieldId: node.fieldId, ...emptyDateComparison };
  }

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

  const condition = { ...node, value };
  return source === 'savedView' ? normalizeSavedViewCondition(condition) : condition;
};

export const normalizeLegacyRecordFilterForV2 = (
  filter: unknown,
  fieldMetaById: ReadonlyMap<string, IRecordFilterFieldMeta>,
  currentUserId?: string,
  source: 'query' | 'savedView' = 'query'
): Result<RecordFilter | undefined | null, DomainError> =>
  mapFilter(filter, fieldMetaById).map((mapped) => {
    if (!mapped) return mapped;
    return normalizeMappedNode(mapped, fieldMetaById, currentUserId, source) ?? undefined;
  });

type TriggerFilterFieldMeta = IRecordFilterFieldMeta & {
  type: FieldType;
  cellValueType: CellValueType;
  isMultipleCellValue: boolean;
};

const normalizeTriggerFilter = (
  filter: IFilterSet,
  fieldMetaById: ReadonlyMap<string, TriggerFilterFieldMeta>,
  currentUserId: string
): Result<RecordFilter, DomainError> => {
  const items: RecordFilterNode[] = [];
  for (const item of filter.filterSet) {
    if ('filterSet' in item) {
      const group = normalizeTriggerFilter(item, fieldMetaById, currentUserId);
      if (group.isErr()) return err(group.error);
      if (group.value) items.push(group.value);
      continue;
    }

    const field = fieldMetaById.get(item.fieldId);
    const operator = item.isSymbol
      ? field &&
        Object.entries(getFilterOperatorMapping(field)).find(
          ([, symbol]) => symbol === item.operator
        )?.[0]
      : item.operator;
    const mapped = operator
      ? mapV1FilterItem(item, field, operator as RecordFilterOperator)
      : ok(null);
    if (mapped.isErr()) return err(mapped.error);
    const normalized =
      mapped.value && normalizeMappedNode(mapped.value, fieldMetaById, currentUserId);
    if (!normalized) {
      return err(
        domainError.validation({
          message: 'Invalid automation trigger filter condition',
          details: { fieldId: item.fieldId, operator: item.operator },
        })
      );
    }
    items.push(normalized);
  }
  return ok(items.length ? { conjunction: filter.conjunction, items } : null);
};

/** A trigger must never run with a partially translated filter. */
export const normalizeLegacyTriggerFilterForV2 = (
  table: ITableReadModel,
  filter: IFilterSet,
  currentUserId: string
): Result<RecordFilter, DomainError> =>
  safeTry(function* () {
    const fieldMetaById = new Map<string, TriggerFilterFieldMeta>();
    const visitor = new FieldValueTypeVisitor();
    for (const fieldId of extractFieldIdsFromFilter(filter)) {
      const field = yield* table.getField((candidate) => candidate.id().toString() === fieldId);
      const { cellValueType, isMultipleCellValue } = yield* field.accept(visitor);
      const source =
        field instanceof LookupField || field instanceof ConditionalLookupField
          ? yield* field.innerField()
          : field;
      const sourceType = source.type();
      const formatting = isDateField(source)
        ? source.formatting()
        : sourceType.equals(V2FieldType.createdTime()) ||
            sourceType.equals(V2FieldType.lastModifiedTime())
          ? (source as CreatedTimeField | LastModifiedTimeField).formatting()
          : undefined;
      fieldMetaById.set(fieldId, {
        type: sourceType.toString() as FieldType,
        cellValueType: cellValueType.toString() as CellValueType,
        isMultipleCellValue: isMultipleCellValue.toBoolean(),
        options: formatting && { formatting: { timeZone: formatting.timeZone().toString() } },
      });
    }
    return normalizeTriggerFilter(filter, fieldMetaById, currentUserId);
  });
