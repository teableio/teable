import {
  canonicalizeField,
  canonicalizeRecord,
  canonicalizeSnapshot,
  canonicalizeTable,
  canonicalizeValue,
  canonicalizeView,
  cloneVcsValue,
  deepEqualVcs,
  isStoredVcsField,
  normalizeRecordFields,
  sortFieldsCanonically,
  sortRecordsCanonically,
  sortTablesCanonically,
  sortViewsCanonically,
} from './fieldClassification';
import type {
  IBaseVcsSnapshot,
  IFieldVcsSnapshot,
  IRecordVcsSnapshot,
  ITableVcsSnapshot,
  IThreeWayMergeResult,
  IVcsConflict,
  IViewVcsSnapshot,
  VcsMultiValueStrategy,
} from './types';

interface MergeAccumulator {
  conflicts: IVcsConflict[];
  autoMergedCount: number;
}

interface SelectChoice {
  id: string;
  name: string;
  color: string;
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeScalar3Way<T>(
  baseVal: T,
  oursVal: T,
  theirsVal: T,
  acc: MergeAccumulator
): { value: T; conflict: boolean } {
  if (deepEqualVcs(oursVal, theirsVal)) {
    if (!deepEqualVcs(baseVal, oursVal)) {
      acc.autoMergedCount += 1;
    }
    return { value: oursVal, conflict: false };
  }
  if (deepEqualVcs(oursVal, baseVal)) {
    acc.autoMergedCount += 1;
    return { value: theirsVal, conflict: false };
  }
  if (deepEqualVcs(theirsVal, baseVal)) {
    return { value: oursVal, conflict: false };
  }
  return { value: oursVal, conflict: true };
}

function mergeRecordKeyValues3Way(
  baseObj: Readonly<Record<string, unknown>> | undefined,
  oursObj: Readonly<Record<string, unknown>> | undefined,
  theirsObj: Readonly<Record<string, unknown>> | undefined,
  acc: MergeAccumulator,
  skipKeys?: Set<string>
): { merged: Record<string, unknown> | undefined; hasConflict: boolean } {
  const b = baseObj ?? {};
  const o = oursObj ?? {};
  const t = theirsObj ?? {};

  const keys = new Set<string>([...Object.keys(b), ...Object.keys(o), ...Object.keys(t)]);
  const merged: Record<string, unknown> = {};
  let hasConflict = false;

  for (const key of Array.from(keys).sort()) {
    if (skipKeys?.has(key)) {
      continue;
    }
    const res = mergeScalar3Way(b[key] ?? null, o[key] ?? null, t[key] ?? null, acc);
    if (res.conflict) {
      hasConflict = true;
    }
    if (res.value !== null && res.value !== undefined) {
      merged[key] = res.value;
    }
  }

  return {
    merged: Object.keys(merged).length > 0 ? merged : undefined,
    hasConflict,
  };
}

function isChoiceArray(val: unknown): val is SelectChoice[] {
  return (
    Array.isArray(val) &&
    val.every((item) => isPlainObject(item) && typeof item.id === 'string' && item.id.length > 0)
  );
}

function collectOrderedChoiceIds(
  oList: readonly SelectChoice[],
  tList: readonly SelectChoice[]
): string[] {
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  for (const c of [...oList, ...tList]) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      orderedIds.push(c.id);
    }
  }
  return orderedIds;
}

function mergeOursOnlyChoice(
  bChoice: SelectChoice | undefined,
  oChoice: SelectChoice,
  acc: MergeAccumulator
): { merged?: SelectChoice; hasConflict: boolean } {
  if (!bChoice) {
    return { merged: cloneVcsValue(oChoice), hasConflict: false };
  }
  if (deepEqualVcs(oChoice, bChoice)) {
    acc.autoMergedCount += 1;
    return { hasConflict: false };
  }
  return { merged: cloneVcsValue(oChoice), hasConflict: true };
}

function mergeTheirsOnlyChoice(
  bChoice: SelectChoice | undefined,
  tChoice: SelectChoice,
  acc: MergeAccumulator
): { merged?: SelectChoice; hasConflict: boolean } {
  if (!bChoice) {
    acc.autoMergedCount += 1;
    return { merged: cloneVcsValue(tChoice), hasConflict: false };
  }
  if (!deepEqualVcs(tChoice, bChoice)) {
    return { merged: cloneVcsValue(tChoice), hasConflict: true };
  }
  return { hasConflict: false };
}

function mergeSingleChoiceEntry(
  bChoice: SelectChoice | undefined,
  oChoice: SelectChoice | undefined,
  tChoice: SelectChoice | undefined,
  acc: MergeAccumulator
): { merged?: SelectChoice; hasConflict: boolean } {
  if (oChoice && tChoice) {
    const res = mergeScalar3Way(bChoice ?? null, oChoice, tChoice, acc);
    return {
      merged: res.value ? cloneVcsValue(res.value) : undefined,
      hasConflict: res.conflict,
    };
  }
  if (oChoice) {
    return mergeOursOnlyChoice(bChoice, oChoice, acc);
  }
  if (tChoice) {
    return mergeTheirsOnlyChoice(bChoice, tChoice, acc);
  }
  return { hasConflict: false };
}

function mergeSelectChoices(
  baseChoices: unknown,
  oursChoices: unknown,
  theirsChoices: unknown,
  acc: MergeAccumulator
): { mergedChoices: SelectChoice[]; hasConflict: boolean } {
  const bList = isChoiceArray(baseChoices) ? baseChoices : [];
  const oList = isChoiceArray(oursChoices) ? oursChoices : [];
  const tList = isChoiceArray(theirsChoices) ? theirsChoices : [];

  const bMap = new Map(bList.map((c) => [c.id, c]));
  const oMap = new Map(oList.map((c) => [c.id, c]));
  const tMap = new Map(tList.map((c) => [c.id, c]));

  const mergedChoices: SelectChoice[] = [];
  let hasConflict = false;

  for (const choiceId of collectOrderedChoiceIds(oList, tList)) {
    const entry = mergeSingleChoiceEntry(
      bMap.get(choiceId),
      oMap.get(choiceId),
      tMap.get(choiceId),
      acc
    );
    if (entry.hasConflict) {
      hasConflict = true;
    }
    if (entry.merged) {
      mergedChoices.push(entry.merged);
    }
  }

  return { mergedChoices, hasConflict };
}

function mergeFieldOptions(
  fieldType: string,
  baseOpts: Record<string, unknown> | undefined,
  oursOpts: Record<string, unknown> | undefined,
  theirsOpts: Record<string, unknown> | undefined,
  acc: MergeAccumulator
): { merged: Record<string, unknown> | undefined; hasConflict: boolean } {
  const isSelect = fieldType === 'singleSelect' || fieldType === 'multipleSelect';
  const skipKeys = isSelect ? new Set(['choices']) : undefined;
  const keyMerge = mergeRecordKeyValues3Way(baseOpts, oursOpts, theirsOpts, acc, skipKeys);
  const merged = keyMerge.merged ? { ...keyMerge.merged } : {};
  let hasConflict = keyMerge.hasConflict;

  const hasChoices =
    baseOpts?.choices !== undefined ||
    oursOpts?.choices !== undefined ||
    theirsOpts?.choices !== undefined;

  if (isSelect && hasChoices) {
    const choiceMerge = mergeSelectChoices(
      baseOpts?.choices,
      oursOpts?.choices,
      theirsOpts?.choices,
      acc
    );
    if (choiceMerge.hasConflict) {
      hasConflict = true;
    }
    merged.choices = choiceMerge.mergedChoices;
  }

  return {
    merged: Object.keys(merged).length > 0 ? merged : undefined,
    hasConflict,
  };
}

function mergeFieldSchemas(
  tableId: string,
  baseField: IFieldVcsSnapshot | undefined,
  oursField: IFieldVcsSnapshot,
  theirsField: IFieldVcsSnapshot,
  acc: MergeAccumulator
): IFieldVcsSnapshot {
  let hasConflict = false;

  const mergeProp = <K extends keyof IFieldVcsSnapshot>(
    key: K,
    defaultVal: IFieldVcsSnapshot[K]
  ): IFieldVcsSnapshot[K] => {
    const res = mergeScalar3Way(
      baseField?.[key] ?? defaultVal,
      oursField[key] ?? defaultVal,
      theirsField[key] ?? defaultVal,
      acc
    );
    if (res.conflict) {
      hasConflict = true;
    }
    return res.value;
  };

  const name = mergeProp('name', '');
  const type = mergeProp('type', oursField.type);
  const notNull = mergeProp('notNull', false);
  const unique = mergeProp('unique', false);
  const description = mergeProp('description', null);
  const aiConfig = mergeProp('aiConfig', undefined);
  const isLookup = mergeProp('isLookup', false);
  const isConditionalLookup = mergeProp('isConditionalLookup', false);
  const isPrimary = mergeProp('isPrimary', false);
  const isComputed = mergeProp('isComputed', false);

  const optionsRes = mergeFieldOptions(
    type,
    baseField?.options,
    oursField.options,
    theirsField.options,
    acc
  );
  if (optionsRes.hasConflict) {
    hasConflict = true;
  }

  if (hasConflict) {
    acc.conflicts.push({
      id: `field:${tableId}:${oursField.id}`,
      kind: 'field_schema_conflict',
      tableId,
      entityId: oursField.id,
      fieldId: oursField.id,
      baseValue: baseField ? canonicalizeField(baseField) : null,
      oursValue: canonicalizeField(oursField),
      theirsValue: canonicalizeField(theirsField),
      message: `Conflicting schema edits on field "${oursField.name}" (${oursField.id})`,
    });
  }

  return canonicalizeField({
    id: oursField.id,
    name,
    type,
    ...(optionsRes.merged !== undefined ? { options: optionsRes.merged } : {}),
    ...(oursField.notNull !== undefined || theirsField.notNull !== undefined || notNull
      ? { notNull }
      : {}),
    ...(oursField.unique !== undefined || theirsField.unique !== undefined || unique
      ? { unique }
      : {}),
    ...(description !== null && description !== undefined ? { description } : {}),
    ...(aiConfig !== undefined ? { aiConfig } : {}),
    ...(isLookup ? { isLookup } : {}),
    ...(isConditionalLookup ? { isConditionalLookup } : {}),
    isPrimary,
    isComputed,
  });
}

function didSideModifyDeletedField(
  fieldId: string,
  baseField: IFieldVcsSnapshot,
  survivingField: IFieldVcsSnapshot,
  baseTable: ITableVcsSnapshot,
  survivingTable: ITableVcsSnapshot
): boolean {
  if (!deepEqualVcs(canonicalizeField(baseField), canonicalizeField(survivingField))) {
    return true;
  }

  const baseRecordMap = new Map(baseTable.records.map((r) => [r.id, r]));
  for (const record of survivingTable.records) {
    const cellVal = record.fields[fieldId];
    if (cellVal === null || cellVal === undefined) {
      continue;
    }
    const baseRecord = baseRecordMap.get(record.id);
    if (!baseRecord || !deepEqualVcs(baseRecord.fields[fieldId] ?? null, cellVal)) {
      return true;
    }
  }
  return false;
}

interface MergeFieldsResult {
  fields: IFieldVcsSnapshot[];
  deleteModifyFieldKeepSide: Map<string, 'ours' | 'theirs'>;
}

function resolveOneSidedField(
  tableId: string,
  fieldId: string,
  bField: IFieldVcsSnapshot | undefined,
  survivingField: IFieldVcsSnapshot,
  survivingSide: 'ours' | 'theirs',
  baseTable: ITableVcsSnapshot | undefined,
  survivingTable: ITableVcsSnapshot,
  deleteModifyFieldKeepSide: Map<string, 'ours' | 'theirs'>,
  acc: MergeAccumulator
): IFieldVcsSnapshot | undefined {
  if (!bField) {
    if (survivingSide === 'theirs') {
      acc.autoMergedCount += 1;
    }
    return canonicalizeField(survivingField);
  }
  if (
    baseTable &&
    didSideModifyDeletedField(fieldId, bField, survivingField, baseTable, survivingTable)
  ) {
    acc.conflicts.push({
      id: `field:${tableId}:${fieldId}:delete_modify`,
      kind: 'field_delete_modify',
      tableId,
      entityId: fieldId,
      fieldId,
      baseValue: canonicalizeField(bField),
      oursValue: survivingSide === 'ours' ? canonicalizeField(survivingField) : null,
      theirsValue: survivingSide === 'theirs' ? canonicalizeField(survivingField) : null,
      message:
        survivingSide === 'ours'
          ? `Field "${survivingField.name}" (${fieldId}) was deleted remotely but modified locally`
          : `Field "${survivingField.name}" (${fieldId}) was deleted locally but modified remotely`,
    });
    deleteModifyFieldKeepSide.set(fieldId, survivingSide);
    return canonicalizeField(survivingField);
  }
  if (survivingSide === 'ours') {
    acc.autoMergedCount += 1;
  }
  return undefined;
}

function mergeTableFields3Way(
  baseTable: ITableVcsSnapshot | undefined,
  oursTable: ITableVcsSnapshot,
  theirsTable: ITableVcsSnapshot,
  acc: MergeAccumulator
): MergeFieldsResult {
  const bMap = new Map((baseTable?.fields ?? []).map((f) => [f.id, f]));
  const oMap = new Map(oursTable.fields.map((f) => [f.id, f]));
  const tMap = new Map(theirsTable.fields.map((f) => [f.id, f]));

  const allIds = new Set<string>([...bMap.keys(), ...oMap.keys(), ...tMap.keys()]);
  const mergedFields: IFieldVcsSnapshot[] = [];
  const deleteModifyFieldKeepSide = new Map<string, 'ours' | 'theirs'>();

  for (const fieldId of Array.from(allIds).sort()) {
    const bField = bMap.get(fieldId);
    const oField = oMap.get(fieldId);
    const tField = tMap.get(fieldId);

    if (oField && tField) {
      mergedFields.push(mergeFieldSchemas(oursTable.id, bField, oField, tField, acc));
      continue;
    }

    const surviving = oField ?? tField;
    if (!surviving) continue;

    const side = oField ? 'ours' : 'theirs';
    const resolved = resolveOneSidedField(
      oursTable.id,
      fieldId,
      bField,
      surviving,
      side,
      baseTable,
      oField ? oursTable : theirsTable,
      deleteModifyFieldKeepSide,
      acc
    );
    if (resolved) {
      mergedFields.push(resolved);
    }
  }

  return {
    fields: sortFieldsCanonically(mergedFields),
    deleteModifyFieldKeepSide,
  };
}

function mergeViewSchemas(
  tableId: string,
  baseView: IViewVcsSnapshot | undefined,
  oursView: IViewVcsSnapshot,
  theirsView: IViewVcsSnapshot,
  acc: MergeAccumulator
): IViewVcsSnapshot {
  let hasConflict = false;

  const mergeProp = <K extends keyof IViewVcsSnapshot>(
    key: K,
    defaultVal: IViewVcsSnapshot[K]
  ): IViewVcsSnapshot[K] => {
    const res = mergeScalar3Way(
      baseView?.[key] ?? defaultVal,
      oursView[key] ?? defaultVal,
      theirsView[key] ?? defaultVal,
      acc
    );
    if (res.conflict) {
      hasConflict = true;
    }
    return res.value;
  };

  const name = mergeProp('name', '');
  const type = mergeProp('type', oursView.type);
  const description = mergeProp('description', null);
  const order = mergeProp('order', undefined);

  const optionsRes = mergeRecordKeyValues3Way(
    baseView?.options,
    oursView.options,
    theirsView.options,
    acc
  );
  const columnMetaRes = mergeRecordKeyValues3Way(
    baseView?.columnMeta,
    oursView.columnMeta,
    theirsView.columnMeta,
    acc
  );
  const queryRes = mergeRecordKeyValues3Way(
    baseView?.query as Record<string, unknown> | undefined,
    oursView.query as Record<string, unknown> | undefined,
    theirsView.query as Record<string, unknown> | undefined,
    acc
  );
  if (optionsRes.hasConflict || columnMetaRes.hasConflict || queryRes.hasConflict) {
    hasConflict = true;
  }

  if (hasConflict) {
    acc.conflicts.push({
      id: `view:${tableId}:${oursView.id}`,
      kind: 'view_schema_conflict',
      tableId,
      entityId: oursView.id,
      baseValue: baseView ? canonicalizeView(baseView) : null,
      oursValue: canonicalizeView(oursView),
      theirsValue: canonicalizeView(theirsView),
      message: `Conflicting edits on view "${oursView.name}" (${oursView.id})`,
    });
  }

  return canonicalizeView({
    id: oursView.id,
    name,
    type,
    ...(description !== null && description !== undefined ? { description } : {}),
    ...(columnMetaRes.merged ? { columnMeta: columnMetaRes.merged } : {}),
    ...(optionsRes.merged ? { options: optionsRes.merged } : {}),
    ...(queryRes.merged ? { query: queryRes.merged as IViewVcsSnapshot['query'] } : {}),
    ...(order !== undefined ? { order } : {}),
  });
}

function resolveOneSidedView(
  tableId: string,
  viewId: string,
  bView: IViewVcsSnapshot | undefined,
  survivingView: IViewVcsSnapshot,
  survivingSide: 'ours' | 'theirs',
  acc: MergeAccumulator
): IViewVcsSnapshot | undefined {
  if (!bView) {
    if (survivingSide === 'theirs') {
      acc.autoMergedCount += 1;
    }
    return canonicalizeView(survivingView);
  }
  if (!deepEqualVcs(canonicalizeView(bView), canonicalizeView(survivingView))) {
    acc.conflicts.push({
      id: `view:${tableId}:${viewId}:delete_modify`,
      kind: 'view_delete_modify',
      tableId,
      entityId: viewId,
      baseValue: canonicalizeView(bView),
      oursValue: survivingSide === 'ours' ? canonicalizeView(survivingView) : null,
      theirsValue: survivingSide === 'theirs' ? canonicalizeView(survivingView) : null,
      message:
        survivingSide === 'ours'
          ? `View "${survivingView.name}" (${viewId}) was deleted remotely but modified locally`
          : `View "${survivingView.name}" (${viewId}) was deleted locally but modified remotely`,
    });
    return canonicalizeView(survivingView);
  }
  if (survivingSide === 'ours') {
    acc.autoMergedCount += 1;
  }
  return undefined;
}

function mergeTableViews3Way(
  baseTable: ITableVcsSnapshot | undefined,
  oursTable: ITableVcsSnapshot,
  theirsTable: ITableVcsSnapshot,
  acc: MergeAccumulator
): IViewVcsSnapshot[] {
  const bMap = new Map((baseTable?.views ?? []).map((v) => [v.id, v]));
  const oMap = new Map(oursTable.views.map((v) => [v.id, v]));
  const tMap = new Map(theirsTable.views.map((v) => [v.id, v]));

  const allIds = new Set<string>([...bMap.keys(), ...oMap.keys(), ...tMap.keys()]);
  const mergedViews: IViewVcsSnapshot[] = [];

  for (const viewId of Array.from(allIds).sort()) {
    const bView = bMap.get(viewId);
    const oView = oMap.get(viewId);
    const tView = tMap.get(viewId);

    if (oView && tView) {
      mergedViews.push(mergeViewSchemas(oursTable.id, bView, oView, tView, acc));
      continue;
    }

    const surviving = oView ?? tView;
    if (!surviving) continue;

    const resolved = resolveOneSidedView(
      oursTable.id,
      viewId,
      bView,
      surviving,
      oView ? 'ours' : 'theirs',
      acc
    );
    if (resolved) {
      mergedViews.push(resolved);
    }
  }

  return sortViewsCanonically(mergedViews);
}

function isStringArrayOrNull(val: unknown): val is string[] | null {
  return val === null || (Array.isArray(val) && val.every((x) => typeof x === 'string'));
}

function isLinkArrayOrNull(val: unknown): val is { id: string }[] | null {
  return (
    val === null ||
    (Array.isArray(val) && val.every((item) => isPlainObject(item) && typeof item.id === 'string'))
  );
}

function mergeMultipleSelectArraySet(
  bCell: unknown,
  oCell: unknown,
  tCell: unknown
): { ok: true; value: unknown } | { ok: false } {
  if (!isStringArrayOrNull(bCell) || !isStringArrayOrNull(oCell) || !isStringArrayOrNull(tCell)) {
    return { ok: false };
  }
  const bSet = new Set(bCell ?? []);
  const oArr = oCell ?? [];
  const tArr = tCell ?? [];
  const oSet = new Set(oArr);
  const tSet = new Set(tArr);

  const merged: string[] = [];
  const seen = new Set<string>();
  for (const item of [...oArr, ...tArr]) {
    if (seen.has(item)) continue;
    const removedByOurs = bSet.has(item) && !oSet.has(item);
    const removedByTheirs = bSet.has(item) && !tSet.has(item);
    if (!removedByOurs && !removedByTheirs) {
      seen.add(item);
      merged.push(item);
    }
  }
  return { ok: true, value: merged.length > 0 ? merged : null };
}

function mergeLinkArraySet(
  bCell: unknown,
  oCell: unknown,
  tCell: unknown
): { ok: true; value: unknown } | { ok: false } {
  if (!isLinkArrayOrNull(bCell) || !isLinkArrayOrNull(oCell) || !isLinkArrayOrNull(tCell)) {
    return { ok: false };
  }
  const bArr = bCell ?? [];
  const oArr = oCell ?? [];
  const tArr = tCell ?? [];

  const bIds = new Set(bArr.map((x) => x.id));
  const oMap = new Map(oArr.map((x) => [x.id, x]));
  const tMap = new Map(tArr.map((x) => [x.id, x]));

  const merged: { id: string }[] = [];
  const seen = new Set<string>();
  for (const item of [...oArr, ...tArr]) {
    if (seen.has(item.id)) continue;
    const removedByOurs = bIds.has(item.id) && !oMap.has(item.id);
    const removedByTheirs = bIds.has(item.id) && !tMap.has(item.id);
    if (!removedByOurs && !removedByTheirs) {
      seen.add(item.id);
      merged.push(cloneVcsValue(oMap.get(item.id) ?? tMap.get(item.id) ?? item));
    }
  }
  return { ok: true, value: merged.length > 0 ? merged : null };
}

function trySetMultiValueMerge(
  field: IFieldVcsSnapshot | undefined,
  bCell: unknown,
  oCell: unknown,
  tCell: unknown,
  strategy: VcsMultiValueStrategy
): { ok: true; value: unknown } | { ok: false } {
  if (strategy !== 'set' || !field) {
    return { ok: false };
  }
  if (field.type === 'multipleSelect') {
    return mergeMultipleSelectArraySet(bCell, oCell, tCell);
  }
  if (field.type === 'link') {
    return mergeLinkArraySet(bCell, oCell, tCell);
  }
  return { ok: false };
}

function mergeSingleCell3Way(params: {
  tableId: string;
  recordId: string;
  field: IFieldVcsSnapshot;
  keepSide: 'ours' | 'theirs' | undefined;
  bVal: unknown;
  oVal: unknown;
  tVal: unknown;
  multiValueStrategy: VcsMultiValueStrategy;
  acc: MergeAccumulator;
}): unknown {
  const { tableId, recordId, field, keepSide, bVal, oVal, tVal, multiValueStrategy, acc } = params;
  if (keepSide) {
    return keepSide === 'ours' ? oVal : tVal;
  }

  const scalar = mergeScalar3Way(bVal, oVal, tVal, acc);
  if (!scalar.conflict) {
    return scalar.value;
  }

  const setResult = trySetMultiValueMerge(field, bVal, oVal, tVal, multiValueStrategy);
  if (setResult.ok) {
    acc.autoMergedCount += 1;
    return setResult.value;
  }

  acc.conflicts.push({
    id: `cell:${tableId}:${recordId}:${field.id}`,
    kind: 'cell_edit_edit',
    tableId,
    entityId: recordId,
    fieldId: field.id,
    baseValue: bVal,
    oursValue: oVal,
    theirsValue: tVal,
    message: `Conflicting edits on record ${recordId} field "${field.name}" (${field.id})`,
  });
  return oVal;
}

function mergeExistingRecord3Way(
  tableId: string,
  storedFields: readonly IFieldVcsSnapshot[],
  storedFieldMap: ReadonlyMap<string, IFieldVcsSnapshot>,
  deleteModifyFieldKeepSide: ReadonlyMap<string, 'ours' | 'theirs'>,
  bRec: IRecordVcsSnapshot | undefined,
  oRec: IRecordVcsSnapshot,
  tRec: IRecordVcsSnapshot,
  multiValueStrategy: VcsMultiValueStrategy,
  acc: MergeAccumulator
): IRecordVcsSnapshot {
  const bCells = bRec ? normalizeRecordFields(bRec.fields, storedFields) : {};
  const oCells = normalizeRecordFields(oRec.fields, storedFields);
  const tCells = normalizeRecordFields(tRec.fields, storedFields);

  const mergedFields: Record<string, unknown> = {};
  for (const field of storedFields) {
    if (!storedFieldMap.has(field.id)) {
      continue;
    }
    const mergedVal = mergeSingleCell3Way({
      tableId,
      recordId: oRec.id,
      field,
      keepSide: deleteModifyFieldKeepSide.get(field.id),
      bVal: bCells[field.id] ?? null,
      oVal: oCells[field.id] ?? null,
      tVal: tCells[field.id] ?? null,
      multiValueStrategy,
      acc,
    });
    if (mergedVal !== null && mergedVal !== undefined) {
      mergedFields[field.id] = mergedVal;
    }
  }

  const ordersRes = mergeRecordKeyValues3Way(bRec?.orders, oRec.orders, tRec.orders, acc);
  const mergedVersion = tRec.version ?? bRec?.version ?? oRec.version;
  return canonicalizeRecord(
    {
      id: oRec.id,
      fields: mergedFields,
      autoNumber: tRec.autoNumber ?? bRec?.autoNumber ?? oRec.autoNumber,
      ...(mergedVersion !== undefined ? { version: mergedVersion } : {}),
      ...(ordersRes.merged ? { orders: ordersRes.merged as Record<string, number> } : {}),
    },
    storedFields
  );
}

function didRecordChange(
  baseRec: IRecordVcsSnapshot,
  sideRec: IRecordVcsSnapshot,
  storedFields: readonly IFieldVcsSnapshot[]
): boolean {
  const bNorm = normalizeRecordFields(baseRec.fields, storedFields);
  const sNorm = normalizeRecordFields(sideRec.fields, storedFields);
  return !deepEqualVcs(bNorm, sNorm) || !deepEqualVcs(baseRec.orders, sideRec.orders);
}

function resolveOneSidedRecord(
  tableId: string,
  recordId: string,
  storedFields: readonly IFieldVcsSnapshot[],
  bRec: IRecordVcsSnapshot | undefined,
  survivingRec: IRecordVcsSnapshot,
  survivingSide: 'ours' | 'theirs',
  acc: MergeAccumulator
): IRecordVcsSnapshot | undefined {
  if (!bRec) {
    if (survivingSide === 'theirs') {
      acc.autoMergedCount += 1;
    }
    return canonicalizeRecord(survivingRec, storedFields);
  }
  if (didRecordChange(bRec, survivingRec, storedFields)) {
    acc.conflicts.push({
      id: `record:${tableId}:${recordId}:delete_modify`,
      kind: 'record_delete_modify',
      tableId,
      entityId: recordId,
      baseValue: canonicalizeRecord(bRec, storedFields),
      oursValue: survivingSide === 'ours' ? canonicalizeRecord(survivingRec, storedFields) : null,
      theirsValue:
        survivingSide === 'theirs' ? canonicalizeRecord(survivingRec, storedFields) : null,
      message:
        survivingSide === 'ours'
          ? `Record ${recordId} was deleted remotely but modified locally`
          : `Record ${recordId} was deleted locally but modified remotely`,
    });
    return canonicalizeRecord(survivingRec, storedFields);
  }
  if (survivingSide === 'ours') {
    acc.autoMergedCount += 1;
  }
  return undefined;
}

function mergeTableRecords3Way(
  tableId: string,
  mergedFields: readonly IFieldVcsSnapshot[],
  deleteModifyFieldKeepSide: ReadonlyMap<string, 'ours' | 'theirs'>,
  baseTable: ITableVcsSnapshot | undefined,
  oursTable: ITableVcsSnapshot,
  theirsTable: ITableVcsSnapshot,
  multiValueStrategy: VcsMultiValueStrategy,
  acc: MergeAccumulator
): IRecordVcsSnapshot[] {
  const storedFields = mergedFields.filter(isStoredVcsField);
  const storedFieldMap = new Map(storedFields.map((f) => [f.id, f]));

  const bMap = new Map((baseTable?.records ?? []).map((r) => [r.id, r]));
  const oMap = new Map(oursTable.records.map((r) => [r.id, r]));
  const tMap = new Map(theirsTable.records.map((r) => [r.id, r]));

  const allIds = new Set<string>([...bMap.keys(), ...oMap.keys(), ...tMap.keys()]);
  const mergedRecords: IRecordVcsSnapshot[] = [];

  for (const recordId of Array.from(allIds).sort()) {
    const bRec = bMap.get(recordId);
    const oRec = oMap.get(recordId);
    const tRec = tMap.get(recordId);

    if (oRec && tRec) {
      mergedRecords.push(
        mergeExistingRecord3Way(
          tableId,
          storedFields,
          storedFieldMap,
          deleteModifyFieldKeepSide,
          bRec,
          oRec,
          tRec,
          multiValueStrategy,
          acc
        )
      );
      continue;
    }

    const surviving = oRec ?? tRec;
    if (!surviving) continue;

    const resolved = resolveOneSidedRecord(
      tableId,
      recordId,
      storedFields,
      bRec,
      surviving,
      oRec ? 'ours' : 'theirs',
      acc
    );
    if (resolved) {
      mergedRecords.push(resolved);
    }
  }

  return sortRecordsCanonically(mergedRecords, storedFields);
}

function isConstraintEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') {
    return true;
  }
  return Array.isArray(value) && value.length === 0;
}

interface TableRecordLookupMaps {
  base: ReadonlyMap<string, IRecordVcsSnapshot>;
  ours: ReadonlyMap<string, IRecordVcsSnapshot>;
  theirs: ReadonlyMap<string, IRecordVcsSnapshot>;
}

function validateFieldNotNullConstraints(
  table: ITableVcsSnapshot,
  field: IFieldVcsSnapshot,
  recMaps: TableRecordLookupMaps,
  conflicts: IVcsConflict[]
): void {
  for (const record of table.records) {
    const val = record.fields[field.id];
    if (isConstraintEmptyValue(val)) {
      conflicts.push({
        id: `constraint:notNull:${table.id}:${record.id}:${field.id}`,
        kind: 'constraint_conflict',
        tableId: table.id,
        entityId: record.id,
        fieldId: field.id,
        baseValue: recMaps.base.get(record.id)?.fields[field.id] ?? null,
        oursValue: recMaps.ours.get(record.id)?.fields[field.id] ?? null,
        theirsValue: recMaps.theirs.get(record.id)?.fields[field.id] ?? null,
        message: `Merged record ${record.id} violates notNull constraint on field "${field.name}" (${field.id})`,
      });
    }
  }
}

function validateFieldUniqueConstraints(
  table: ITableVcsSnapshot,
  field: IFieldVcsSnapshot,
  recMaps: TableRecordLookupMaps,
  conflicts: IVcsConflict[]
): void {
  const valueBuckets = new Map<string, IRecordVcsSnapshot[]>();
  for (const record of table.records) {
    const val = record.fields[field.id];
    if (val === null || val === undefined || val === '') {
      continue;
    }
    const key = JSON.stringify(canonicalizeValue(val));
    const list = valueBuckets.get(key) ?? [];
    list.push(record);
    valueBuckets.set(key, list);
  }

  for (const group of valueBuckets.values()) {
    for (const duplicate of group.slice(1)) {
      conflicts.push({
        id: `constraint:unique:${table.id}:${duplicate.id}:${field.id}`,
        kind: 'constraint_conflict',
        tableId: table.id,
        entityId: duplicate.id,
        fieldId: field.id,
        baseValue: recMaps.base.get(duplicate.id)?.fields[field.id] ?? null,
        oursValue: recMaps.ours.get(duplicate.id)?.fields[field.id] ?? null,
        theirsValue: recMaps.theirs.get(duplicate.id)?.fields[field.id] ?? null,
        message: `Merged record ${duplicate.id} has duplicate value for unique field "${field.name}" (${field.id})`,
      });
    }
  }
}

function validateTableConstraints(
  table: ITableVcsSnapshot,
  baseTable: ITableVcsSnapshot | undefined,
  oursTable: ITableVcsSnapshot | undefined,
  theirsTable: ITableVcsSnapshot | undefined,
  conflicts: IVcsConflict[]
): void {
  const recMaps: TableRecordLookupMaps = {
    base: new Map((baseTable?.records ?? []).map((r) => [r.id, r])),
    ours: new Map((oursTable?.records ?? []).map((r) => [r.id, r])),
    theirs: new Map((theirsTable?.records ?? []).map((r) => [r.id, r])),
  };

  for (const field of table.fields) {
    if (!isStoredVcsField(field)) {
      continue;
    }
    if (field.notNull) {
      validateFieldNotNullConstraints(table, field, recMaps, conflicts);
    }
    if (field.unique) {
      validateFieldUniqueConstraints(table, field, recMaps, conflicts);
    }
  }
}

function mergeTable3Way(
  baseTable: ITableVcsSnapshot | undefined,
  oursTable: ITableVcsSnapshot,
  theirsTable: ITableVcsSnapshot,
  multiValueStrategy: VcsMultiValueStrategy,
  acc: MergeAccumulator
): ITableVcsSnapshot {
  const nameRes = mergeScalar3Way(
    baseTable?.name ?? oursTable.name,
    oursTable.name,
    theirsTable.name,
    acc
  );
  const primaryRes = mergeScalar3Way(
    baseTable?.primaryFieldId ?? oursTable.primaryFieldId,
    oursTable.primaryFieldId,
    theirsTable.primaryFieldId,
    acc
  );
  const fieldMergeResult = mergeTableFields3Way(baseTable, oursTable, theirsTable, acc);
  const mergedViews = mergeTableViews3Way(baseTable, oursTable, theirsTable, acc);
  const mergedRecords = mergeTableRecords3Way(
    oursTable.id,
    fieldMergeResult.fields,
    fieldMergeResult.deleteModifyFieldKeepSide,
    baseTable,
    oursTable,
    theirsTable,
    multiValueStrategy,
    acc
  );

  return canonicalizeTable({
    id: oursTable.id,
    name: nameRes.value,
    ...((oursTable.dbTableName ?? theirsTable.dbTableName)
      ? { dbTableName: oursTable.dbTableName ?? theirsTable.dbTableName }
      : {}),
    primaryFieldId: primaryRes.value,
    fields: fieldMergeResult.fields,
    views: mergedViews,
    records: mergedRecords,
  });
}

function didTableChange(baseTable: ITableVcsSnapshot, sideTable: ITableVcsSnapshot): boolean {
  return !deepEqualVcs(canonicalizeTable(baseTable), canonicalizeTable(sideTable));
}

function resolveOneSidedTable(
  tableId: string,
  bTable: ITableVcsSnapshot | undefined,
  survivingTable: ITableVcsSnapshot,
  survivingSide: 'ours' | 'theirs',
  acc: MergeAccumulator
): ITableVcsSnapshot | undefined {
  if (!bTable) {
    if (survivingSide === 'theirs') {
      acc.autoMergedCount += 1;
    }
    const cleanTable = canonicalizeTable(survivingTable);
    validateTableConstraints(
      cleanTable,
      undefined,
      survivingSide === 'ours' ? survivingTable : undefined,
      survivingSide === 'theirs' ? survivingTable : undefined,
      acc.conflicts
    );
    return cleanTable;
  }

  if (didTableChange(bTable, survivingTable)) {
    acc.conflicts.push({
      id: `table:${tableId}:delete_modify`,
      kind: 'table_delete_modify',
      tableId,
      entityId: tableId,
      baseValue: canonicalizeTable(bTable),
      oursValue: survivingSide === 'ours' ? canonicalizeTable(survivingTable) : null,
      theirsValue: survivingSide === 'theirs' ? canonicalizeTable(survivingTable) : null,
      message:
        survivingSide === 'ours'
          ? `Table "${survivingTable.name}" (${tableId}) was deleted remotely but modified locally`
          : `Table "${survivingTable.name}" (${tableId}) was deleted locally but modified remotely`,
    });
    return canonicalizeTable(survivingTable);
  }

  if (survivingSide === 'ours') {
    acc.autoMergedCount += 1;
  }
  return undefined;
}

export function threeWayMerge(input: {
  base: IBaseVcsSnapshot;
  ours: IBaseVcsSnapshot;
  theirs: IBaseVcsSnapshot;
  options?: { multiValueStrategy?: VcsMultiValueStrategy };
}): IThreeWayMergeResult {
  const { base, ours, theirs, options } = input;
  const multiValueStrategy: VcsMultiValueStrategy = options?.multiValueStrategy ?? 'strict';
  const acc: MergeAccumulator = { conflicts: [], autoMergedCount: 0 };

  const bMap = new Map(base.tables.map((t) => [t.id, t]));
  const oMap = new Map(ours.tables.map((t) => [t.id, t]));
  const tMap = new Map(theirs.tables.map((t) => [t.id, t]));

  const allTableIds = new Set<string>([...bMap.keys(), ...oMap.keys(), ...tMap.keys()]);
  const mergedTables: ITableVcsSnapshot[] = [];

  for (const tableId of Array.from(allTableIds).sort()) {
    const bTable = bMap.get(tableId);
    const oTable = oMap.get(tableId);
    const tTable = tMap.get(tableId);

    if (oTable && tTable) {
      const mergedTable = mergeTable3Way(bTable, oTable, tTable, multiValueStrategy, acc);
      validateTableConstraints(mergedTable, bTable, oTable, tTable, acc.conflicts);
      mergedTables.push(mergedTable);
      continue;
    }

    const surviving = oTable ?? tTable;
    if (!surviving) continue;

    const resolved = resolveOneSidedTable(
      tableId,
      bTable,
      surviving,
      oTable ? 'ours' : 'theirs',
      acc
    );
    if (resolved) {
      mergedTables.push(resolved);
    }
  }

  const baseNameMerge = mergeScalar3Way(base.baseName, ours.baseName, theirs.baseName, acc);

  const mergedSnapshot = canonicalizeSnapshot({
    formatVersion: 1,
    baseId: ours.baseId,
    baseName: baseNameMerge.value,
    revision: theirs.revision,
    capturedAt: theirs.capturedAt,
    tables: sortTablesCanonically(mergedTables),
    ...((theirs.accessScope ?? ours.accessScope)
      ? { accessScope: theirs.accessScope ?? ours.accessScope }
      : {}),
  });

  return {
    mergedSnapshot,
    conflicts: acc.conflicts,
    autoMergedCount: acc.autoMergedCount,
  };
}
