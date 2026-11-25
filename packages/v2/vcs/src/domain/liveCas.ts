import {
  canonicalizeCellValueForCas,
  canonicalizeField,
  canonicalizeView,
  deepEqualVcs,
} from './fieldClassification';
import type {
  IDeletedTableVcsPatch,
  IFieldVcsSnapshot,
  IRecordVcsSnapshot,
  ITableVcsPatch,
  ITableVcsSnapshot,
  IVcsPushCasConflict,
  IViewVcsSnapshot,
} from './types';

function checkAddedAndUpdatedFieldsCas(
  tableId: string,
  tp: ITableVcsPatch,
  liveFieldMap: ReadonlyMap<string, IFieldVcsSnapshot>,
  conflicts: IVcsPushCasConflict[]
): void {
  for (const fAdd of tp.fieldsAdded) {
    const liveF = liveFieldMap.get(fAdd.id);
    if (liveF) {
      conflicts.push({
        key: `${tableId}:field:${fAdd.id}`,
        tableId,
        entityType: 'field',
        entityId: fAdd.id,
        before: null,
        current: liveF,
      });
    }
  }
  for (const fUpd of tp.fieldsUpdated) {
    const liveF = liveFieldMap.get(fUpd.fieldId);
    if (!liveF || !deepEqualVcs(canonicalizeField(fUpd.before), canonicalizeField(liveF))) {
      conflicts.push({
        key: `${tableId}:field:${fUpd.fieldId}`,
        tableId,
        entityType: 'field',
        entityId: fUpd.fieldId,
        before: fUpd.before,
        current: liveF ?? null,
      });
    }
  }
}

function checkDeletedFieldsCas(
  tableId: string,
  tp: ITableVcsPatch,
  liveFieldMap: ReadonlyMap<string, IFieldVcsSnapshot>,
  conflicts: IVcsPushCasConflict[]
): void {
  for (const fDel of tp.fieldsDeleted) {
    const liveF = liveFieldMap.get(fDel.fieldId);
    const mismatch =
      !liveF ||
      !fDel.before ||
      !deepEqualVcs(canonicalizeField(fDel.before), canonicalizeField(liveF));
    if (mismatch) {
      conflicts.push({
        key: `${tableId}:field:${fDel.fieldId}`,
        tableId,
        entityType: 'field',
        entityId: fDel.fieldId,
        before: fDel.before ?? null,
        current: liveF ?? null,
      });
    }
  }
}

export function collectTableFieldCasConflicts(
  tableId: string,
  tp: ITableVcsPatch,
  liveFieldMap: ReadonlyMap<string, IFieldVcsSnapshot>
): IVcsPushCasConflict[] {
  const conflicts: IVcsPushCasConflict[] = [];
  checkAddedAndUpdatedFieldsCas(tableId, tp, liveFieldMap, conflicts);
  checkDeletedFieldsCas(tableId, tp, liveFieldMap, conflicts);
  return conflicts;
}

function checkAddedAndUpdatedViewsCas(
  tableId: string,
  tp: ITableVcsPatch,
  liveViewMap: ReadonlyMap<string, IViewVcsSnapshot>,
  conflicts: IVcsPushCasConflict[]
): void {
  for (const vAdd of tp.viewsAdded) {
    const liveV = liveViewMap.get(vAdd.id);
    if (liveV) {
      conflicts.push({
        key: `${tableId}:view:${vAdd.id}`,
        tableId,
        entityType: 'view',
        entityId: vAdd.id,
        before: null,
        current: liveV,
      });
    }
  }
  for (const vUpd of tp.viewsUpdated) {
    const liveV = liveViewMap.get(vUpd.viewId);
    if (!liveV || !deepEqualVcs(canonicalizeView(vUpd.before), canonicalizeView(liveV))) {
      conflicts.push({
        key: `${tableId}:view:${vUpd.viewId}`,
        tableId,
        entityType: 'view',
        entityId: vUpd.viewId,
        before: vUpd.before,
        current: liveV ?? null,
      });
    }
  }
}

function checkDeletedViewsCas(
  tableId: string,
  tp: ITableVcsPatch,
  liveViewMap: ReadonlyMap<string, IViewVcsSnapshot>,
  conflicts: IVcsPushCasConflict[]
): void {
  for (const vDel of tp.viewsDeleted) {
    const liveV = liveViewMap.get(vDel.viewId);
    const mismatch =
      !liveV ||
      !vDel.before ||
      !deepEqualVcs(canonicalizeView(vDel.before), canonicalizeView(liveV));
    if (mismatch) {
      conflicts.push({
        key: `${tableId}:view:${vDel.viewId}`,
        tableId,
        entityType: 'view',
        entityId: vDel.viewId,
        before: vDel.before ?? null,
        current: liveV ?? null,
      });
    }
  }
}

export function collectTableViewCasConflicts(
  tableId: string,
  tp: ITableVcsPatch,
  liveViewMap: ReadonlyMap<string, IViewVcsSnapshot>
): IVcsPushCasConflict[] {
  const conflicts: IVcsPushCasConflict[] = [];
  checkAddedAndUpdatedViewsCas(tableId, tp, liveViewMap, conflicts);
  checkDeletedViewsCas(tableId, tp, liveViewMap, conflicts);
  return conflicts;
}

function collectUpdatedRecordCasConflicts(
  tableId: string,
  tp: ITableVcsPatch,
  liveFieldMap: ReadonlyMap<string, IFieldVcsSnapshot>,
  liveRecMap: ReadonlyMap<string, IRecordVcsSnapshot>,
  conflicts: IVcsPushCasConflict[]
): void {
  for (const recUpd of tp.recordsUpdated) {
    const liveRec = liveRecMap.get(recUpd.recordId);
    if (!liveRec) {
      conflicts.push({
        key: `${tableId}:record:${recUpd.recordId}`,
        tableId,
        entityType: 'record',
        entityId: recUpd.recordId,
        before: recUpd.cellChanges,
        current: null,
      });
      continue;
    }
    for (const change of recUpd.orderChanges ?? []) {
      const current = liveRec.orders?.[change.viewId] ?? liveRec.autoNumber ?? null;
      if (current !== change.before) {
        conflicts.push({
          key: `${tableId}:record:${recUpd.recordId}:order:${change.viewId}`,
          tableId,
          entityType: 'record',
          entityId: recUpd.recordId,
          before: change.before,
          current,
        });
      }
    }
    for (const cell of recUpd.cellChanges) {
      const fieldSnap = liveFieldMap.get(cell.fieldId);
      const beforeNorm = canonicalizeCellValueForCas(cell.before, fieldSnap);
      const currentNorm = canonicalizeCellValueForCas(liveRec.fields[cell.fieldId], fieldSnap);
      if (!deepEqualVcs(beforeNorm, currentNorm)) {
        conflicts.push({
          key: `${tableId}:record:${recUpd.recordId}:${cell.fieldId}`,
          tableId,
          entityType: 'cell',
          entityId: recUpd.recordId,
          fieldId: cell.fieldId,
          before: beforeNorm,
          current: currentNorm,
        });
      }
    }
  }
}

function checkDeletedSingleRecordCells(
  tableId: string,
  recordId: string,
  beforeRec: IRecordVcsSnapshot,
  liveRec: IRecordVcsSnapshot,
  liveFields: readonly IFieldVcsSnapshot[],
  conflicts: IVcsPushCasConflict[]
): void {
  for (const fieldSnap of liveFields) {
    if (fieldSnap.isComputed) continue;
    const beforeNorm = canonicalizeCellValueForCas(beforeRec.fields[fieldSnap.id], fieldSnap);
    const currentNorm = canonicalizeCellValueForCas(liveRec.fields[fieldSnap.id], fieldSnap);
    if (!deepEqualVcs(beforeNorm, currentNorm)) {
      conflicts.push({
        key: `${tableId}:record:${recordId}:${fieldSnap.id}`,
        tableId,
        entityType: 'cell',
        entityId: recordId,
        fieldId: fieldSnap.id,
        before: beforeNorm,
        current: currentNorm,
      });
    }
  }
}

export function collectTableRecordCasConflicts(
  tableId: string,
  tp: ITableVcsPatch,
  liveFieldMap: ReadonlyMap<string, IFieldVcsSnapshot>,
  liveFields: readonly IFieldVcsSnapshot[],
  liveRecMap: ReadonlyMap<string, IRecordVcsSnapshot>
): IVcsPushCasConflict[] {
  const conflicts: IVcsPushCasConflict[] = [];
  for (const rAdd of tp.recordsAdded) {
    const existing = liveRecMap.get(rAdd.id);
    if (existing) {
      conflicts.push({
        key: `${tableId}:record:${rAdd.id}`,
        tableId,
        entityType: 'record',
        entityId: rAdd.id,
        before: null,
        current: existing,
      });
    }
  }

  collectUpdatedRecordCasConflicts(tableId, tp, liveFieldMap, liveRecMap, conflicts);

  for (const recDel of tp.recordsDeleted) {
    const liveRec = liveRecMap.get(recDel.recordId);
    if (!liveRec) {
      conflicts.push({
        key: `${tableId}:record:${recDel.recordId}`,
        tableId,
        entityType: 'record',
        entityId: recDel.recordId,
        before: recDel.before ?? null,
        current: null,
      });
      continue;
    }
    if (!recDel.before) {
      conflicts.push({
        key: `${tableId}:record:${recDel.recordId}`,
        tableId,
        entityType: 'record',
        entityId: recDel.recordId,
        before: null,
        current: liveRec,
      });
      continue;
    }
    if (liveRec.version !== undefined && recDel.before.version !== liveRec.version) {
      conflicts.push({
        key: `${tableId}:record:${recDel.recordId}`,
        tableId,
        entityType: 'record',
        entityId: recDel.recordId,
        before: { version: recDel.before.version },
        current: { version: liveRec.version },
      });
    }
    checkDeletedSingleRecordCells(
      tableId,
      recDel.recordId,
      recDel.before,
      liveRec,
      liveFields,
      conflicts
    );
  }

  return conflicts;
}

function checkDeletedTableFieldsCas(
  tableId: string,
  expectedFields: readonly IFieldVcsSnapshot[],
  liveFields: readonly IFieldVcsSnapshot[],
  conflicts: IVcsPushCasConflict[]
): void {
  const expectedMap = new Map(expectedFields.map((f) => [f.id, f]));
  const liveMap = new Map(liveFields.map((f) => [f.id, f]));
  for (const expField of expectedFields) {
    const liveField = liveMap.get(expField.id);
    if (!liveField || !deepEqualVcs(canonicalizeField(expField), canonicalizeField(liveField))) {
      conflicts.push({
        key: `${tableId}:field:${expField.id}`,
        tableId,
        entityType: 'field',
        entityId: expField.id,
        before: expField,
        current: liveField ?? null,
      });
    }
  }
  for (const liveField of liveFields) {
    if (!expectedMap.has(liveField.id)) {
      conflicts.push({
        key: `${tableId}:field:${liveField.id}`,
        tableId,
        entityType: 'field',
        entityId: liveField.id,
        before: null,
        current: liveField,
      });
    }
  }
}

function checkDeletedTableViewsCas(
  tableId: string,
  expectedViews: readonly IViewVcsSnapshot[],
  liveViews: readonly IViewVcsSnapshot[],
  conflicts: IVcsPushCasConflict[]
): void {
  const expectedMap = new Map(expectedViews.map((v) => [v.id, v]));
  const liveMap = new Map(liveViews.map((v) => [v.id, v]));
  for (const expView of expectedViews) {
    const liveView = liveMap.get(expView.id);
    if (!liveView || !deepEqualVcs(canonicalizeView(expView), canonicalizeView(liveView))) {
      conflicts.push({
        key: `${tableId}:view:${expView.id}`,
        tableId,
        entityType: 'view',
        entityId: expView.id,
        before: expView,
        current: liveView ?? null,
      });
    }
  }
  for (const liveView of liveViews) {
    if (!expectedMap.has(liveView.id)) {
      conflicts.push({
        key: `${tableId}:view:${liveView.id}`,
        tableId,
        entityType: 'view',
        entityId: liveView.id,
        before: null,
        current: liveView,
      });
    }
  }
}

function checkDeletedTableRecordsCas(
  tableId: string,
  expectedRecords: readonly IRecordVcsSnapshot[],
  liveRecords: readonly IRecordVcsSnapshot[],
  liveFields: readonly IFieldVcsSnapshot[],
  conflicts: IVcsPushCasConflict[]
): void {
  const expectedMap = new Map(expectedRecords.map((r) => [r.id, r]));
  const liveMap = new Map(liveRecords.map((r) => [r.id, r]));
  for (const expRec of expectedRecords) {
    const liveRec = liveMap.get(expRec.id);
    if (!liveRec) {
      conflicts.push({
        key: `${tableId}:record:${expRec.id}`,
        tableId,
        entityType: 'record',
        entityId: expRec.id,
        before: expRec,
        current: null,
      });
      continue;
    }
    if (
      expRec.version !== undefined &&
      liveRec.version !== undefined &&
      expRec.version !== liveRec.version
    ) {
      conflicts.push({
        key: `${tableId}:record:${expRec.id}`,
        tableId,
        entityType: 'record',
        entityId: expRec.id,
        before: { version: expRec.version },
        current: { version: liveRec.version },
      });
    }
    checkDeletedSingleRecordCells(tableId, expRec.id, expRec, liveRec, liveFields, conflicts);
  }
  for (const liveRec of liveRecords) {
    if (!expectedMap.has(liveRec.id)) {
      conflicts.push({
        key: `${tableId}:record:${liveRec.id}`,
        tableId,
        entityType: 'record',
        entityId: liveRec.id,
        before: null,
        current: liveRec,
      });
    }
  }
}

export function collectDeletedTableCasConflicts(
  delTable: IDeletedTableVcsPatch,
  liveTable: ITableVcsSnapshot | undefined
): IVcsPushCasConflict[] {
  if (!liveTable || !delTable.before) {
    return [
      {
        key: `${delTable.tableId}:table:${delTable.tableId}`,
        tableId: delTable.tableId,
        entityType: 'table',
        entityId: delTable.tableId,
        before: delTable.before ?? null,
        current: liveTable ?? null,
      },
    ];
  }

  const conflicts: IVcsPushCasConflict[] = [];
  if (
    delTable.before.name !== liveTable.name ||
    delTable.before.primaryFieldId !== liveTable.primaryFieldId
  ) {
    conflicts.push({
      key: `${delTable.tableId}:table:${delTable.tableId}`,
      tableId: delTable.tableId,
      entityType: 'table',
      entityId: delTable.tableId,
      before: {
        name: delTable.before.name,
        primaryFieldId: delTable.before.primaryFieldId,
      },
      current: {
        name: liveTable.name,
        primaryFieldId: liveTable.primaryFieldId,
      },
    });
  }

  checkDeletedTableFieldsCas(delTable.tableId, delTable.before.fields, liveTable.fields, conflicts);
  checkDeletedTableViewsCas(delTable.tableId, delTable.before.views, liveTable.views, conflicts);
  checkDeletedTableRecordsCas(
    delTable.tableId,
    delTable.before.records,
    liveTable.records,
    liveTable.fields,
    conflicts
  );

  return conflicts;
}
