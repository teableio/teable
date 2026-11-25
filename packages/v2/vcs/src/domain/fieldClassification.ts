import type {
  IBaseVcsSnapshot,
  IFieldVcsSnapshot,
  IRecordVcsSnapshot,
  ITableVcsSnapshot,
  IViewVcsSnapshot,
} from './types';

export const COMPUTED_FIELD_TYPES = new Set<string>([
  'formula',
  'rollup',
  'lookup',
  'conditionalLookup',
  'conditionalRollup',
  'createdTime',
  'lastModifiedTime',
  'createdBy',
  'lastModifiedBy',
  'autoNumber',
]);

export function isComputedFieldType(
  type: string,
  isLookup?: boolean,
  isConditionalLookup?: boolean
): boolean {
  if (isLookup || isConditionalLookup) {
    return true;
  }
  return COMPUTED_FIELD_TYPES.has(type);
}

export function isStoredVcsField(
  field: Pick<IFieldVcsSnapshot, 'type' | 'isLookup' | 'isConditionalLookup' | 'isComputed'>
): boolean {
  if (field.isComputed) {
    return false;
  }
  return !isComputedFieldType(field.type, field.isLookup, field.isConditionalLookup);
}

export function isEmptyVcsCellValue(value: unknown): boolean {
  return value === null || value === undefined;
}

export function canonicalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  if (typeof value === 'object') {
    if (value instanceof Date) return value.toJSON();
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const child = record[key];
      if (child !== undefined) {
        sorted[key] = canonicalizeValue(child);
      }
    }
    return sorted;
  }
  return value;
}

export function cloneVcsValue<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  return structuredClone(value);
}

export function deepEqualVcs(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (a === null || b === null || a === undefined || b === undefined) {
    return a === b;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEqualVcs(item, b[index]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = Object.keys(objA).filter((k) => objA[k] !== undefined);
    const keysB = Object.keys(objB).filter((k) => objB[k] !== undefined);
    if (keysA.length !== keysB.length) {
      return false;
    }
    return keysA.every(
      (key) => Object.prototype.hasOwnProperty.call(objB, key) && deepEqualVcs(objA[key], objB[key])
    );
  }
  return false;
}

function normalizeLinkCasItem(item: unknown): unknown {
  if (item && typeof item === 'object' && !Array.isArray(item) && 'id' in item) {
    const id = (item as { id?: unknown }).id;
    return typeof id === 'string' ? { id } : canonicalizeValue(item);
  }
  if (typeof item === 'string' && item.trim().length > 0) {
    return { id: item.trim() };
  }
  return canonicalizeValue(item);
}

function normalizeSingleSelectCasValue(value: unknown): unknown {
  if (value === '') return null;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as { name?: unknown; id?: unknown };
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.id === 'string') return obj.id;
  }
  return canonicalizeValue(value);
}

function normalizeLinkCasValue(value: unknown): unknown {
  if (!Array.isArray(value)) return normalizeLinkCasItem(value);
  return value.length === 0 ? null : value.map(normalizeLinkCasItem);
}

function normalizeFallbackCasValue(value: unknown): unknown {
  const normalized = canonicalizeValue(value);
  if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
    return Object.keys(normalized).length === 0 ? null : normalized;
  }
  return normalized;
}

export function canonicalizeCellValueForCas(
  value: unknown,
  field?: Pick<IFieldVcsSnapshot, 'type' | 'options' | 'isLookup' | 'isConditionalLookup'>
): unknown {
  if (isEmptyVcsCellValue(value)) {
    return null;
  }
  if (field?.type === 'link') {
    return normalizeLinkCasValue(value);
  }
  if (field?.type === 'singleSelect') {
    return normalizeSingleSelectCasValue(value);
  }
  if ((field?.type === 'multipleSelect' || field?.type === 'attachment') && Array.isArray(value)) {
    return value.length === 0 ? null : value.map((item) => canonicalizeValue(item));
  }
  return normalizeFallbackCasValue(value);
}

export function normalizeRecordFields(
  fields: Readonly<Record<string, unknown>>,
  schemaFields?: readonly Pick<
    IFieldVcsSnapshot,
    'id' | 'type' | 'isLookup' | 'isConditionalLookup' | 'isComputed'
  >[]
): Record<string, unknown> {
  let computedFieldIds: Set<string> | undefined;
  if (schemaFields) {
    computedFieldIds = new Set<string>();
    for (const field of schemaFields) {
      if (!isStoredVcsField(field)) {
        computedFieldIds.add(field.id);
      }
    }
  }

  const normalized: Record<string, unknown> = {};
  for (const fieldId of Object.keys(fields).sort()) {
    if (computedFieldIds?.has(fieldId)) {
      continue;
    }
    const rawValue = fields[fieldId];
    if (isEmptyVcsCellValue(rawValue)) {
      continue;
    }
    normalized[fieldId] = canonicalizeValue(rawValue);
  }
  return normalized;
}

export function sortFieldsCanonically(fields: readonly IFieldVcsSnapshot[]): IFieldVcsSnapshot[] {
  return [...fields]
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) {
        return a.isPrimary ? -1 : 1;
      }
      return a.id.localeCompare(b.id);
    })
    .map((field) => canonicalizeField(field));
}

export function canonicalizeField(field: IFieldVcsSnapshot): IFieldVcsSnapshot {
  return {
    id: field.id,
    name: field.name,
    type: field.type,
    ...(field.options !== undefined
      ? { options: canonicalizeValue(field.options) as Record<string, unknown> }
      : {}),
    ...(field.notNull !== undefined ? { notNull: field.notNull } : {}),
    ...(field.unique !== undefined ? { unique: field.unique } : {}),
    ...(field.description !== undefined ? { description: field.description } : {}),
    ...(field.aiConfig !== undefined ? { aiConfig: canonicalizeValue(field.aiConfig) } : {}),
    ...(field.isLookup !== undefined ? { isLookup: field.isLookup } : {}),
    ...(field.isConditionalLookup !== undefined
      ? { isConditionalLookup: field.isConditionalLookup }
      : {}),
    isPrimary: field.isPrimary,
    isComputed: field.isComputed,
  };
}

export function canonicalizeView(view: IViewVcsSnapshot): IViewVcsSnapshot {
  return {
    id: view.id,
    name: view.name,
    type: view.type,
    ...(view.description !== undefined ? { description: view.description } : {}),
    ...(view.columnMeta !== undefined
      ? { columnMeta: canonicalizeValue(view.columnMeta) as Record<string, unknown> }
      : {}),
    ...(view.options !== undefined
      ? { options: canonicalizeValue(view.options) as Record<string, unknown> }
      : {}),
    ...(view.query !== undefined
      ? { query: canonicalizeValue(view.query) as IViewVcsSnapshot['query'] }
      : {}),
    ...(view.order !== undefined ? { order: view.order } : {}),
  };
}

export function sortViewsCanonically(views: readonly IViewVcsSnapshot[]): IViewVcsSnapshot[] {
  return [...views]
    .sort((a, b) => {
      const orderDiff = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
      if (orderDiff !== 0) {
        return orderDiff;
      }
      return a.id.localeCompare(b.id);
    })
    .map((view) => canonicalizeView(view));
}

export function canonicalizeRecord(
  record: IRecordVcsSnapshot,
  schemaFields?: readonly IFieldVcsSnapshot[],
  options?: { preserveComputed?: boolean }
): IRecordVcsSnapshot {
  const fields = options?.preserveComputed
    ? normalizeRecordFields(record.fields)
    : normalizeRecordFields(record.fields, schemaFields);

  let orders: Record<string, number> | undefined;
  if (record.orders) {
    orders = {};
    for (const viewId of Object.keys(record.orders).sort()) {
      const orderVal = record.orders[viewId];
      if (typeof orderVal === 'number') {
        orders[viewId] = orderVal;
      }
    }
    if (Object.keys(orders).length === 0) {
      orders = undefined;
    }
  }

  return {
    id: record.id,
    fields,
    ...(record.version !== undefined ? { version: record.version } : {}),
    ...(record.autoNumber !== undefined ? { autoNumber: record.autoNumber } : {}),
    ...(orders ? { orders } : {}),
  };
}

export function sortRecordsCanonically(
  records: readonly IRecordVcsSnapshot[],
  schemaFields?: readonly IFieldVcsSnapshot[],
  options?: { preserveComputed?: boolean }
): IRecordVcsSnapshot[] {
  return [...records]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((record) => canonicalizeRecord(record, schemaFields, options));
}

export function canonicalizeTable(
  table: ITableVcsSnapshot,
  options?: { preserveComputed?: boolean }
): ITableVcsSnapshot {
  const fields = sortFieldsCanonically(table.fields);
  return {
    id: table.id,
    name: table.name,
    ...(table.dbTableName !== undefined ? { dbTableName: table.dbTableName } : {}),
    primaryFieldId: table.primaryFieldId,
    fields,
    views: sortViewsCanonically(table.views),
    records: sortRecordsCanonically(table.records, fields, options),
  };
}

export function sortTablesCanonically(
  tables: readonly ITableVcsSnapshot[],
  options?: { preserveComputed?: boolean }
): ITableVcsSnapshot[] {
  return [...tables]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((table) => canonicalizeTable(table, options));
}

export function canonicalizeSnapshot(
  snapshot: IBaseVcsSnapshot,
  options?: { preserveComputed?: boolean }
): IBaseVcsSnapshot {
  return {
    formatVersion: snapshot.formatVersion,
    baseId: snapshot.baseId,
    baseName: snapshot.baseName,
    revision: snapshot.revision,
    ...(snapshot.cursor !== undefined ? { cursor: snapshot.cursor } : {}),
    capturedAt: snapshot.capturedAt,
    tables: sortTablesCanonically(snapshot.tables, options),
    ...(snapshot.accessScope !== undefined
      ? { accessScope: canonicalizeValue(snapshot.accessScope) as IBaseVcsSnapshot['accessScope'] }
      : {}),
  };
}
