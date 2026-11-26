import { extractLinkItems } from './chunkPatch';
import { vcsDomainError } from './errors';
import { deepEqualVcs, isStoredVcsField } from './fieldClassification';
import type {
  IBaseVcsPatch,
  IBaseVcsSnapshot,
  IFieldUpdatePatch,
  IFieldVcsSnapshot,
  IRecordUpdatePatch,
  IRecordVcsSnapshot,
} from './types';

function unsupported(message: string, details: Readonly<Record<string, unknown>>): never {
  throw vcsDomainError.validation({ code: 'vcs.unsupported_promotion_patch', message, details });
}

function invalidSelection(message: string, tableId: string, recordId: string): never {
  throw vcsDomainError.validation({
    code: 'vcs.invalid_promotion_selection',
    message,
    details: { tableId, recordId },
  });
}

function choiceNames(options: IFieldVcsSnapshot['options']): Map<string, string> {
  const choices = options?.choices;
  const names = new Map<string, string>();
  if (!Array.isArray(choices)) return names;
  for (const choice of choices) {
    if (isConfig(choice) && typeof choice.id === 'string' && typeof choice.name === 'string') {
      names.set(choice.id, choice.name);
    }
  }
  return names;
}

function validateFieldUpdate(tableId: string, field: IFieldUpdatePatch): void {
  const { before, after, fieldId } = field;
  const details = { tableId, fieldId };
  if (
    before.type !== after.type ||
    before.isPrimary !== after.isPrimary ||
    Boolean(before.isLookup) !== Boolean(after.isLookup) ||
    Boolean(before.isConditionalLookup) !== Boolean(after.isConditionalLookup) ||
    before.isComputed !== after.isComputed
  ) {
    unsupported('This field conversion can rewrite existing records.', details);
  }
  if (deepEqualVcs(before.options, after.options)) return;

  const prior = before.options;
  const next = after.options;
  if (after.type === 'singleSelect' || after.type === 'multipleSelect') {
    const nextNames = choiceNames(next);
    for (const [id, name] of choiceNames(prior)) {
      if (nextNames.get(id) !== name) {
        unsupported('Removing or renaming a choice can rewrite existing records.', {
          ...details,
          choiceId: id,
        });
      }
    }
  }
  if (
    after.type === 'link' &&
    [
      'baseId',
      'foreignTableId',
      'lookupFieldId',
      'relationship',
      'isOneWay',
      'symmetricFieldId',
    ].some((key) => !deepEqualVcs(prior?.[key], next?.[key]))
  ) {
    unsupported('Changing a link relationship can rewrite existing records or fields.', details);
  }
  if (
    (after.type === 'button' && !deepEqualVcs(prior?.workflow, next?.workflow)) ||
    (after.type === 'user' && Boolean(prior?.isMultiple) !== Boolean(next?.isMultiple)) ||
    (after.type === 'rating' &&
      typeof prior?.max === 'number' &&
      typeof next?.max === 'number' &&
      next.max < prior.max)
  ) {
    unsupported('This field option change can rewrite existing records.', details);
  }
}

function validateAddedLinks(patch: IBaseVcsPatch): void {
  const addedLinks = new Map<string, Map<string, IFieldVcsSnapshot>>();
  const collect = (tableId: string, fields: readonly IFieldVcsSnapshot[]) => {
    for (const field of fields) {
      if (field.type !== 'link') continue;
      let links = addedLinks.get(tableId);
      if (!links) {
        links = new Map();
        addedLinks.set(tableId, links);
      }
      links.set(field.id, field);
    }
  };
  for (const table of patch.tablesAdded) collect(table.id, table.fields);
  for (const table of patch.tablesUpdated) collect(table.tableId, table.fieldsAdded);
  for (const [tableId, links] of addedLinks) {
    for (const [fieldId, { options }] of links) {
      if (options?.isOneWay === true) continue;
      const { foreignTableId, symmetricFieldId } = options ?? {};
      const inverse =
        typeof foreignTableId === 'string' && typeof symmetricFieldId === 'string'
          ? addedLinks.get(foreignTableId)?.get(symmetricFieldId)
          : undefined;
      if (
        inverse?.options?.symmetricFieldId !== fieldId ||
        inverse.options.foreignTableId !== tableId
      ) {
        unsupported('Both fields of a new two-way link must be part of the proposal.', {
          tableId,
          fieldId,
        });
      }
    }
  }
}

function computedFieldIds(fields: Iterable<IFieldVcsSnapshot>): Set<string> {
  const ids = new Set<string>();
  for (const field of fields) {
    if (!isStoredVcsField(field)) ids.add(field.id);
  }
  return ids;
}

function stripComputedCells(record: IRecordVcsSnapshot, computed: ReadonlySet<string>) {
  if (!Object.keys(record.fields).some((fieldId) => computed.has(fieldId))) return record;
  return {
    ...record,
    fields: Object.fromEntries(Object.entries(record.fields).filter(([id]) => !computed.has(id))),
  };
}

function promotionFieldsByTable(
  patch: IBaseVcsPatch,
  checkpoint: IBaseVcsSnapshot
): Map<string, Map<string, IFieldVcsSnapshot>> {
  const result = new Map<string, Map<string, IFieldVcsSnapshot>>();
  const checkpointTables = new Map(checkpoint.tables.map((table) => [table.id, table]));
  for (const table of patch.tablesAdded) {
    result.set(table.id, new Map(table.fields.map((field) => [field.id, field])));
  }
  for (const { tableId, fieldsAdded, fieldsUpdated } of patch.tablesUpdated) {
    const fields = new Map(checkpointTables.get(tableId)?.fields.map((field) => [field.id, field]));
    for (const field of fieldsAdded) fields.set(field.id, field);
    for (const { fieldId, after } of fieldsUpdated) fields.set(fieldId, after);
    result.set(tableId, fields);
  }
  return result;
}

function visitPromotionRecordLinks(
  patch: IBaseVcsPatch,
  fieldsByTable: ReadonlyMap<string, ReadonlyMap<string, IFieldVcsSnapshot>>,
  visit: (
    field: IFieldVcsSnapshot,
    after: unknown,
    before: unknown,
    tableId: string,
    recordId: string
  ) => void
): void {
  const visitAdded = (tableId: string, records: readonly IRecordVcsSnapshot[]) => {
    const fields = fieldsByTable.get(tableId);
    for (const record of records) {
      for (const [fieldId, value] of Object.entries(record.fields)) {
        const field = fields?.get(fieldId);
        if (field?.type === 'link' && isStoredVcsField(field)) {
          visit(field, value, null, tableId, record.id);
        }
      }
    }
  };
  for (const table of patch.tablesAdded) visitAdded(table.id, table.records);
  for (const { tableId, recordsAdded, recordsUpdated } of patch.tablesUpdated) {
    visitAdded(tableId, recordsAdded);
    const fields = fieldsByTable.get(tableId);
    for (const { recordId, cellChanges } of recordsUpdated) {
      for (const { fieldId, before, after } of cellChanges) {
        const field = fields?.get(fieldId);
        if (field?.type === 'link' && isStoredVcsField(field)) {
          visit(field, after, before, tableId, recordId);
        }
      }
    }
  }
}

/** Identify checkpoint rows needed to validate link targets in a scoped promotion export. */
export function collectPromotionLinkTargets(
  patch: IBaseVcsPatch,
  checkpoint: IBaseVcsSnapshot
): ReadonlyMap<string, ReadonlySet<string>> {
  const targets = new Map<string, Set<string>>();
  visitPromotionRecordLinks(patch, promotionFieldsByTable(patch, checkpoint), (field, after) => {
    const targetTableId = field.options?.foreignTableId;
    if (typeof targetTableId !== 'string') return;
    for (const { id } of extractLinkItems(after)) {
      const records = targets.get(targetTableId) ?? new Set<string>();
      targets.set(targetTableId, records);
      records.add(id);
    }
  });
  return targets;
}

function validateRecordLinks(
  patch: IBaseVcsPatch,
  fieldsByTable: ReadonlyMap<string, ReadonlyMap<string, IFieldVcsSnapshot>>,
  checkpoint: IBaseVcsSnapshot
): void {
  const addedByTable = new Map<string, Map<string, IRecordVcsSnapshot>>();
  const updatedByTable = new Map<string, Map<string, IRecordUpdatePatch>>();
  for (const table of patch.tablesAdded) {
    addedByTable.set(table.id, new Map(table.records.map((record) => [record.id, record])));
  }
  for (const table of patch.tablesUpdated) {
    addedByTable.set(
      table.tableId,
      new Map(table.recordsAdded.map((record) => [record.id, record]))
    );
    updatedByTable.set(
      table.tableId,
      new Map(table.recordsUpdated.map((record) => [record.recordId, record]))
    );
  }

  const checkpointTables = new Map(checkpoint.tables.map((table) => [table.id, table]));
  const checkpointIds = new Map<string, ReadonlySet<string>>();
  const existsAtCheckpoint = (tableId: string, recordId: string) => {
    let ids = checkpointIds.get(tableId);
    if (!ids) {
      ids = new Set(checkpointTables.get(tableId)?.records.map(({ id }) => id));
      checkpointIds.set(tableId, ids);
    }
    return ids.has(recordId);
  };

  visitPromotionRecordLinks(patch, fieldsByTable, (field, after, before, tableId, recordId) => {
    const fieldId = field.id;
    const { foreignTableId, symmetricFieldId, isOneWay } = field.options ?? {};
    const details = { tableId, recordId, fieldId };
    if (typeof foreignTableId !== 'string') {
      unsupported('The target table of a selected link could not be determined.', details);
    }
    const afterItems = extractLinkItems(after);
    for (const { id } of afterItems) {
      if (!addedByTable.get(foreignTableId)?.has(id) && !existsAtCheckpoint(foreignTableId, id)) {
        unsupported('Include the new record referenced by this link or remove the link.', {
          ...details,
          targetTableId: foreignTableId,
          targetRecordId: id,
        });
      }
    }
    if (isOneWay === true) return;

    const beforeIds = new Set(extractLinkItems(before).map(({ id }) => id));
    const afterIds = new Set(afterItems.map(({ id }) => id));
    const checkInverse = (targetRecordId: string, adding: boolean) => {
      const partner =
        typeof symmetricFieldId === 'string'
          ? fieldsByTable.get(foreignTableId)?.get(symmetricFieldId)
          : undefined;
      if (
        partner?.type === 'link' &&
        partner.options?.foreignTableId === tableId &&
        partner.options.symmetricFieldId === fieldId
      ) {
        const added = addedByTable.get(foreignTableId)?.get(targetRecordId);
        const edited = updatedByTable
          .get(foreignTableId)
          ?.get(targetRecordId)
          ?.cellChanges.find((cell) => cell.fieldId === partner.id);
        const inverseBefore = extractLinkItems(edited?.before).some(({ id }) => id === recordId);
        const inverseAfter = extractLinkItems(added?.fields[partner.id] ?? edited?.after).some(
          ({ id }) => id === recordId
        );
        if (inverseBefore === !adding && inverseAfter === adding) return;
      }
      unsupported('Include the matching change on the other side of this two-way link.', {
        ...details,
        targetTableId: foreignTableId,
        targetRecordId,
        targetFieldId: symmetricFieldId,
      });
    };
    for (const id of beforeIds) {
      if (!afterIds.has(id)) checkInverse(id, false);
    }
    for (const id of afterIds) {
      if (!beforeIds.has(id)) checkInverse(id, true);
    }
  });
}

/** Keep supported schema changes and only the record operations selected for promotion. */
export function selectPromotionPatch(
  patch: IBaseVcsPatch,
  selectedRecords: ReadonlyArray<{ tableId: string; recordId: string }>,
  checkpoint: IBaseVcsSnapshot
): IBaseVcsPatch {
  if (patch.tablesDeleted.length > 0) {
    unsupported('Deleting an existing table can delete records outside the proposal.', {
      tableId: patch.tablesDeleted[0].tableId,
    });
  }
  validateAddedLinks(patch);

  const remaining = new Map<string, Set<string>>();
  for (const { tableId, recordId } of selectedRecords) {
    let records = remaining.get(tableId);
    if (!records) {
      records = new Set();
      remaining.set(tableId, records);
    }
    if (records.has(recordId)) {
      invalidSelection('A record was selected more than once.', tableId, recordId);
    }
    records.add(recordId);
  }

  const fieldsByTable = promotionFieldsByTable(patch, checkpoint);
  const selectAdded = (
    tableId: string,
    records: readonly IRecordVcsSnapshot[],
    computed: ReadonlySet<string>
  ) => {
    const selected: IRecordVcsSnapshot[] = [];
    const selectedIds = remaining.get(tableId);
    if (!selectedIds?.size) return selected;
    for (const record of records) {
      if (selectedIds.delete(record.id)) selected.push(stripComputedCells(record, computed));
    }
    return selected;
  };

  const tablesAdded = patch.tablesAdded.map((table) => {
    return {
      ...table,
      records: selectAdded(table.id, table.records, computedFieldIds(table.fields)),
    };
  });
  const tablesUpdated: IBaseVcsPatch['tablesUpdated'][number][] = [];
  for (const table of patch.tablesUpdated) {
    const { tableId } = table;
    if (table.fieldsDeleted.length > 0) {
      unsupported('Deleting a field can remove data or change dependent fields.', {
        tableId,
        fieldId: table.fieldsDeleted[0].fieldId,
      });
    }
    if (table.viewsDeleted.length > 0) {
      unsupported('Deleting a view can remove row orders or change dependent fields.', {
        tableId,
        viewId: table.viewsDeleted[0].viewId,
      });
    }
    for (const { viewId, before, after } of table.viewsUpdated) {
      if (before.type !== after.type) {
        unsupported('Changing an existing view type is not supported in a proposal.', {
          tableId,
          viewId,
        });
      }
    }
    for (const field of table.fieldsUpdated) validateFieldUpdate(tableId, field);
    const computed = computedFieldIds(fieldsByTable.get(tableId)?.values() ?? []);
    const recordsAdded = selectAdded(tableId, table.recordsAdded, computed);
    const selectedIds = remaining.get(tableId);
    const recordsUpdated = [];
    for (const record of table.recordsUpdated) {
      if (!selectedIds?.has(record.recordId)) continue;
      const cellChanges = record.cellChanges.filter(({ fieldId }) => !computed.has(fieldId));
      if (cellChanges.length === 0 && !record.orderChanges?.length) continue;
      selectedIds.delete(record.recordId);
      recordsUpdated.push({ ...record, cellChanges });
    }
    for (const { recordId } of table.recordsDeleted) {
      if (selectedIds?.has(recordId)) {
        unsupported(
          'Remove this record deletion from the proposal. Deleting a record can clear links in other records.',
          { tableId, recordId }
        );
      }
    }
    if (
      table.nameChange ||
      table.fieldsAdded.length ||
      table.fieldsUpdated.length ||
      table.viewsAdded.length ||
      table.viewsUpdated.length ||
      recordsAdded.length ||
      recordsUpdated.length
    ) {
      tablesUpdated.push({ ...table, recordsAdded, recordsUpdated, recordsDeleted: [] });
    }
  }
  for (const [tableId, recordIds] of remaining) {
    for (const recordId of recordIds) {
      invalidSelection(
        'A selected record has no promotable changes in this table.',
        tableId,
        recordId
      );
    }
  }
  const projected = { tablesAdded, tablesUpdated, tablesDeleted: [] };
  if (selectedRecords.length > 0) validateRecordLinks(projected, fieldsByTable, checkpoint);
  return projected;
}

/** Describe every operation in the projected patch with its full reviewed values. */
export function describePromotionPatch(
  patch: IBaseVcsPatch
): Array<{ table: string; path: string; before?: string; after?: string }> {
  const rows: Array<{ table: string; path: string; before?: string; after?: string }> = [];
  const add = (table: string, path: string, before: unknown, after: unknown) => {
    const previous = JSON.stringify(before, null, 2);
    const next = JSON.stringify(after, null, 2);
    rows.push({
      table,
      path,
      ...(previous !== undefined ? { before: previous } : {}),
      ...(next !== undefined ? { after: next } : {}),
    });
  };
  const label = (kind: string, name: string, id: string) => `${kind} ${name} (${id})`;
  const describeUpdate = (table: string, path: string, before: object, after: object) => {
    const diff = (prefix: string, from: Record<string, unknown>, to: Record<string, unknown>) => {
      for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
        if (!deepEqualVcs(from[key], to[key])) add(table, `${prefix} / ${key}`, from[key], to[key]);
      }
    };
    const from: Record<string, unknown> = { ...before };
    const to: Record<string, unknown> = { ...after };
    for (const key of ['options', 'query']) {
      const previous = from[key];
      const next = to[key];
      if (isConfig(previous) && isConfig(next)) {
        diff(`${path} / ${key}`, previous, next);
        delete from[key];
        delete to[key];
      }
    }
    diff(path, from, to);
  };

  for (const { fields, views, records, ...table } of patch.tablesAdded) {
    add(table.name, `Table ${table.id}`, undefined, table);
    for (const field of fields) {
      add(table.name, label('Field', field.name, field.id), undefined, field);
    }
    for (const view of views) add(table.name, label('View', view.name, view.id), undefined, view);
    for (const record of records) add(table.name, `Record ${record.id}`, undefined, record);
  }
  for (const { tableId, tableName, before } of patch.tablesDeleted) {
    add(tableName ?? before.name, `Table ${tableId}`, before, undefined);
  }
  for (const table of patch.tablesUpdated) {
    const name = table.nameChange?.to ?? table.tableId;
    if (table.nameChange) add(name, 'Table name', table.nameChange.from, table.nameChange.to);
    const fields = new Map<string, string>();
    for (const field of table.fieldsAdded) {
      fields.set(field.id, field.name);
      add(name, label('Field', field.name, field.id), undefined, field);
    }
    for (const { fieldId, before, after } of table.fieldsUpdated) {
      fields.set(fieldId, after.name);
      describeUpdate(name, label('Field', after.name, fieldId), before, after);
    }
    for (const { fieldId, before } of table.fieldsDeleted) {
      add(name, label('Field', before.name, fieldId), before, undefined);
    }
    for (const view of table.viewsAdded)
      add(name, label('View', view.name, view.id), undefined, view);
    for (const { viewId, before, after } of table.viewsUpdated) {
      describeUpdate(name, label('View', after.name, viewId), before, after);
    }
    for (const { viewId, before } of table.viewsDeleted) {
      add(name, label('View', before.name, viewId), before, undefined);
    }
    for (const record of table.recordsAdded) add(name, `Record ${record.id}`, undefined, record);
    for (const { recordId, before } of table.recordsDeleted) {
      add(name, `Record ${recordId}`, before, undefined);
    }
    for (const { recordId, cellChanges, orderChanges } of table.recordsUpdated) {
      for (const { fieldId, before, after } of cellChanges) {
        const fieldName = fields.get(fieldId);
        const fieldLabel = fieldName ? label('Field', fieldName, fieldId) : `Field ${fieldId}`;
        add(name, `Record ${recordId} / ${fieldLabel}`, before, after);
      }
      for (const { viewId, before, after } of orderChanges ?? []) {
        add(name, `Record ${recordId} / Order in view ${viewId}`, before, after);
      }
    }
  }
  return rows;
}

function isConfig(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
