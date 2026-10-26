import { ListTableRecordsQuery, UpdateFieldCommand, UpdateRecordCommand } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';

import type { ReproTrigger } from './deadLetter';
import { createReproContext, executeReproCommand, getReproQueryBus } from './execution';
import type { ReproStructure, ReproStructureField } from './structure';

export type ApplyTriggerContext = {
  container: DependencyContainer;
  structure: ReproStructure;
  tableIdMap: Record<string, string>;
  fieldIdMap: Record<string, string>;
};

export type ReproSampleRows = Record<string, Array<Record<string, unknown>>>;

export type AppliedTrigger = {
  kind: ReproTrigger['kind'];
  tableId: string;
  fieldIds: string[];
  recordIds: string[];
  description: string;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const syntheticValue = (field: ReproStructureField, index: number): unknown => {
  switch (field.type) {
    case 'number':
    case 'rating':
    case 'autoNumber':
      return index + 1;
    case 'checkbox':
      return index % 2 === 0;
    case 'date':
      return '2026-01-01T00:00:00.000Z';
    case 'singleSelect':
    case 'multipleSelect': {
      const choices = asRecord(field.options)?.choices;
      const first = Array.isArray(choices) ? asRecord(choices[0]) : undefined;
      const name = first && typeof first.name === 'string' ? first.name : 'Choice_1';
      return field.type === 'multipleSelect' ? [name] : name;
    }
    default:
      return `repro ${index + 1}`;
  }
};

const isComputedField = (field: ReproStructureField) =>
  field.type === 'formula' ||
  field.type === 'lookup' ||
  field.type === 'rollup' ||
  field.type === 'conditionalLookup' ||
  field.type === 'conditionalRollup';

const isWritableField = (field: ReproStructureField) =>
  !isComputedField(field) && field.type !== 'link' && field.type !== 'attachment';

const readRecords = async (
  container: DependencyContainer,
  tableId: string
): Promise<Array<{ id: string; fields: Record<string, unknown> }>> => {
  const queryBus = getReproQueryBus(container);
  const queryResult = ListTableRecordsQuery.create({ tableId, fieldKeyType: 'id', limit: 100 });
  if (queryResult.isErr()) throw queryResult.error;
  const result = await queryBus.execute<
    ListTableRecordsQuery,
    { records: Array<{ id: string; fields: Record<string, unknown> }> }
  >(createReproContext(), queryResult.value);
  if (result.isErr()) throw result.error;
  return result.value.records;
};

const buildRecordFields = (
  structure: ReproStructure,
  declaredTableId: string,
  declaredFieldIds: string[],
  index: number
): Record<string, unknown> => {
  const table = structure.tables.find((entry) => entry.id === declaredTableId);
  const byId = new Map(table?.fields.map((field) => [field.id, field]) ?? []);
  const targetFields = declaredFieldIds
    .map((fieldId) => byId.get(fieldId))
    .filter((field): field is ReproStructureField => Boolean(field));

  const writable = targetFields.filter(isWritableField);
  const fallback = table?.fields.find(isWritableField);
  const fields = writable.length > 0 ? writable : fallback ? [fallback] : [];
  return Object.fromEntries(fields.map((field) => [field.id, syntheticValue(field, index)]));
};

/** Import regenerates ids; remap ids embedded in a field-update payload (formulas, configs). */
const remapPayloadIds = (
  value: Record<string, unknown>,
  tableIdMap: Record<string, string>,
  fieldIdMap: Record<string, string>
): Record<string, unknown> => {
  let serialized = JSON.stringify(value);
  for (const [from, to] of [...Object.entries(tableIdMap), ...Object.entries(fieldIdMap)]) {
    if (from !== to) serialized = serialized.split(from).join(to);
  }
  return JSON.parse(serialized) as Record<string, unknown>;
};

export const applyTrigger = async (
  context: ApplyTriggerContext,
  trigger: ReproTrigger
): Promise<AppliedTrigger> => {
  const { container, structure, tableIdMap, fieldIdMap } = context;
  const declaredTableId = trigger.tableId ?? structure.tables[0]?.id;
  if (!declaredTableId) throw new Error('Trigger has no table id');
  const tableId = tableIdMap[declaredTableId] ?? declaredTableId;

  if (trigger.kind === 'field-update') {
    const update = trigger.fieldUpdate;
    if (!update) throw new Error('field-update trigger is missing its payload');
    const mappedTableId = tableIdMap[update.tableId] ?? update.tableId;
    const mappedFieldId = fieldIdMap[update.fieldId] ?? update.fieldId;
    const commandResult = UpdateFieldCommand.create(
      {
        tableId: mappedTableId,
        fieldId: mappedFieldId,
        field: remapPayloadIds(update.field, tableIdMap, fieldIdMap),
      },
      { allowNoop: false }
    );
    if (commandResult.isErr()) throw commandResult.error;
    await executeReproCommand(container, commandResult.value);
    return {
      kind: trigger.kind,
      tableId: mappedTableId,
      fieldIds: [mappedFieldId],
      recordIds: [],
      description: `updated field ${update.fieldId} on table ${update.tableId}`,
    };
  }

  const records = await readRecords(container, tableId);
  if (records.length === 0) {
    throw new Error(
      `Table ${tableId} has no records; generate mock rows before applying a trigger`
    );
  }

  if (trigger.kind === 'link-change') {
    const declaredLinkFieldId = trigger.fieldIds[0];
    if (!declaredLinkFieldId) throw new Error('link-change trigger has no link field');
    const linkFieldId = fieldIdMap[declaredLinkFieldId] ?? declaredLinkFieldId;
    const table = structure.tables.find((entry) => entry.id === declaredTableId);
    const linkField = table?.fields.find((field) => field.id === declaredLinkFieldId);
    const declaredForeignTableId = asRecord(linkField?.options)?.foreignTableId;
    if (typeof declaredForeignTableId !== 'string') {
      throw new Error(`Link field ${declaredLinkFieldId} has no foreignTableId`);
    }
    const foreignTableId = tableIdMap[declaredForeignTableId] ?? declaredForeignTableId;
    const foreignRecords = await readRecords(container, foreignTableId);
    if (foreignRecords.length === 0) {
      throw new Error(`Foreign table ${foreignTableId} has no records to link to`);
    }
    const recordId = records[0]!.id;
    const commandResult = UpdateRecordCommand.create({
      tableId,
      recordId,
      fieldKeyType: 'id',
      fields: { [linkFieldId]: [{ id: foreignRecords[0]!.id }] },
      typecast: true,
    });
    if (commandResult.isErr()) throw commandResult.error;
    await executeReproCommand(container, commandResult.value);
    return {
      kind: trigger.kind,
      tableId,
      fieldIds: [linkFieldId],
      recordIds: [recordId],
      description: `linked record ${recordId} to ${foreignRecords[0]!.id} through ${declaredLinkFieldId}`,
    };
  }

  const recordId = records[0]!.id;
  const fields = buildRecordFields(structure, declaredTableId, trigger.fieldIds, 0);
  const mappedFields = Object.fromEntries(
    Object.entries(fields).map(([fieldId, value]) => [fieldIdMap[fieldId] ?? fieldId, value])
  );
  if (Object.keys(mappedFields).length === 0) {
    throw new Error(`No writable source field on table ${declaredTableId} for a record update`);
  }
  const commandResult = UpdateRecordCommand.create({
    tableId,
    recordId,
    fieldKeyType: 'id',
    fields: mappedFields,
  });
  if (commandResult.isErr()) throw commandResult.error;
  await executeReproCommand(container, commandResult.value);
  return {
    kind: trigger.kind,
    tableId,
    fieldIds: Object.keys(mappedFields),
    recordIds: [recordId],
    description: `updated fields ${Object.keys(mappedFields).join(', ')} on record ${recordId}`,
  };
};
