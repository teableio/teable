import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import type { ReproStructure } from './structure';

/**
 * Dead-letter input.
 *
 * Accepted shapes:
 * - the full row from `computed_update_dead_letter` (snake_case columns)
 * - the admin page payload (`source: teable-admin:computed-outbox-anomaly`)
 * - a wrapped object under `data` / `deadLetter` / `task`
 */
export type ReproDeadLetterStep = {
  tableId: string;
  fieldIds: string[];
  level: number;
};

export type ReproDeadLetter = {
  taskId?: string;
  baseId?: string;
  seedTableId?: string;
  seedRecordIds: string[];
  changeType?: 'insert' | 'update' | 'delete';
  changedFieldIds: string[];
  steps: ReproDeadLetterStep[];
  edges: unknown[];
  attempts?: number;
  maxAttempts?: number;
  lastError?: string;
  failureKind?: string;
  failurePhase?: string;
  failedSql?: string;
  traceData?: unknown;
  raw: unknown;
};

export type ReproTriggerKind = 'record-update' | 'field-update' | 'link-change';

export type ReproTrigger = {
  kind: ReproTriggerKind;
  /** Declared (pre-import) ids; the runner remaps them through the import result. */
  tableId?: string;
  fieldIds: string[];
  recordIds: string[];
  fieldUpdate?: { tableId: string; fieldId: string; field: Record<string, unknown> };
  /** How the trigger was chosen; printed with the report. */
  reason: string;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const readString = (record: Record<string, unknown>, keys: ReadonlyArray<string>) => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
};

const readNumber = (record: Record<string, unknown>, keys: ReadonlyArray<string>) => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
};

const readArray = (record: Record<string, unknown>, keys: ReadonlyArray<string>): unknown[] => {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // column may be null/non-JSON
      }
    }
  }
  return [];
};

const readJson = (record: Record<string, unknown>, keys: ReadonlyArray<string>): unknown => {
  for (const key of keys) {
    const value = record[key];
    if (value == null) continue;
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return undefined;
};

const parseSteps = (value: unknown): ReproDeadLetterStep[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];
    const tableId = readString(record, ['tableId', 'table_id']);
    const fieldIds = readArray(record, ['fieldIds', 'field_ids']).filter(
      (fieldId): fieldId is string => typeof fieldId === 'string'
    );
    const level = readNumber(record, ['level']) ?? 0;
    return tableId ? [{ tableId, fieldIds, level }] : [];
  });
};

export const parseDeadLetterPayload = (value: unknown): ReproDeadLetter => {
  const outer = asRecord(value) ?? {};
  const nested = asRecord(outer.data) ?? asRecord(outer.deadLetter) ?? asRecord(outer.task);
  const record =
    nested && (nested.lastError ?? nested.last_error ?? nested.id)
      ? { ...outer, ...nested }
      : outer;

  const traceData = readJson(record, ['traceData', 'trace_data']);
  const traceRecord = asRecord(traceData);
  const failure = traceRecord ? asRecord(traceRecord.failure) : undefined;
  const execution = traceRecord ? asRecord(traceRecord.execution) : undefined;
  const statement = execution ? asRecord(execution.statement) : undefined;

  const changeTypeValue = readString(record, ['changeType', 'change_type']);
  const changeType =
    changeTypeValue === 'insert' || changeTypeValue === 'update' || changeTypeValue === 'delete'
      ? changeTypeValue
      : undefined;

  const failedSql =
    readString(record, ['failedSql', 'failed_sql']) ??
    (statement ? readString(statement, ['normalizedSql', 'sql']) : undefined);

  return {
    taskId: readString(record, ['taskId', 'task_id', 'id']),
    baseId: readString(record, ['baseId', 'base_id']),
    seedTableId: readString(record, ['seedTableId', 'seed_table_id']),
    seedRecordIds: readArray(record, ['seedRecordIds', 'seed_record_ids']).filter(
      (id): id is string => typeof id === 'string'
    ),
    changeType,
    changedFieldIds: readArray(record, [
      'changedFieldIds',
      'changed_field_ids',
      'sourceFieldIds',
    ]).filter((id): id is string => typeof id === 'string'),
    steps: parseSteps(readArray(record, ['steps'])),
    edges: readArray(record, ['edges']),
    attempts: readNumber(record, ['attempts']),
    maxAttempts: readNumber(record, ['maxAttempts', 'max_attempts']),
    lastError: readString(record, ['lastError', 'last_error']),
    failureKind:
      readString(record, ['failureKind', 'failure_kind']) ??
      (failure ? readString(failure, ['kind']) : undefined),
    failurePhase:
      readString(record, ['failurePhase', 'failure_phase']) ??
      (failure ? readString(failure, ['phase']) : undefined),
    failedSql,
    traceData,
    raw: value,
  };
};

export type DeadLetterRow = {
  id: string;
  base_id: string;
  seed_table_id: string;
  change_type: string;
  seed_record_ids: unknown;
  steps: unknown;
  edges: unknown;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  trace_data: unknown;
};

export const loadDeadLetterFromDb = async (
  db: Kysely<V1TeableDatabase>,
  taskId: string
): Promise<ReproDeadLetter> => {
  const deadLetter = await sql<DeadLetterRow>`
    select "id", "base_id", "seed_table_id", "change_type", "seed_record_ids",
           "steps", "edges", "attempts", "max_attempts", "last_error", "trace_data"
    from "computed_update_dead_letter"
    where "id" = ${taskId}
    limit 1
  `.execute(db);

  if (deadLetter.rows[0]) {
    return parseDeadLetterPayload(deadLetter.rows[0]);
  }

  const outbox = await sql<DeadLetterRow>`
    select "id", "base_id", "seed_table_id", "change_type", "seed_record_ids",
           "steps", "edges", "attempts", "max_attempts", "last_error", null as "trace_data"
    from "computed_update_outbox"
    where "id" = ${taskId}
    limit 1
  `.execute(db);

  if (!outbox.rows[0]) {
    throw new Error(`Computed task not found in dead letter or outbox: ${taskId}`);
  }
  return parseDeadLetterPayload(outbox.rows[0]);
};

export type DeriveTriggerInput = {
  deadLetter?: ReproDeadLetter;
  structure: ReproStructure;
  kind?: ReproTriggerKind;
  tableId?: string;
  fieldId?: string;
  fieldIds?: string[];
  fieldUpdate?: ReproTrigger['fieldUpdate'];
};

export const deriveTrigger = (input: DeriveTriggerInput): ReproTrigger => {
  const { deadLetter, structure } = input;
  const declaredTableId =
    input.tableId ??
    deadLetter?.seedTableId ??
    deadLetter?.steps[0]?.tableId ??
    (input.kind === 'link-change'
      ? structure.tables.find((entry) => entry.fields.some((field) => field.type === 'link'))?.id
      : structure.tables[0]?.id);
  const table =
    structure.tables.find((entry) => entry.id === declaredTableId) ?? structure.tables[0];
  if (!table) {
    throw new Error('Structure has no tables to trigger');
  }
  const resolvedTableId = declaredTableId ?? table.id ?? '';

  if (input.kind === 'field-update') {
    if (!input.fieldUpdate) {
      throw new Error(
        'field-update needs --trigger-json with { tableId, fieldId, field } (declared ids). ' +
          'A dead letter does not persist the original field-change payload.'
      );
    }
    return {
      kind: 'field-update',
      tableId: input.fieldUpdate.tableId,
      fieldIds: [input.fieldUpdate.fieldId],
      recordIds: [],
      fieldUpdate: input.fieldUpdate,
      reason: 'explicit field update payload (--trigger-json)',
    };
  }

  // A dead letter does not persist which user action created the plan, so the
  // default stays with the common case (a record/source-field update). Link and
  // field-schema replays are explicit.
  const kind: ReproTriggerKind = input.kind ?? 'record-update';
  const fieldIds = input.fieldIds?.length
    ? input.fieldIds
    : input.fieldId != null
      ? [input.fieldId]
      : deadLetter?.changedFieldIds.length
        ? deadLetter.changedFieldIds
        : (deadLetterSourceFields(structure, resolvedTableId) ?? defaultChangedFields(table));
  const reason =
    input.kind != null
      ? 'explicit --trigger'
      : deadLetter?.changedFieldIds.length
        ? 'derived from dead-letter changed field ids'
        : 'derived from plan steps/seed table (synthetic values)';

  if (kind === 'link-change') {
    const linkField = findLinkField(structure, resolvedTableId);
    if (!linkField) {
      throw new Error(`No link field on table ${resolvedTableId} for a link-change trigger`);
    }
    return {
      kind,
      tableId: resolvedTableId,
      fieldIds: [linkField.id!],
      recordIds: deadLetter?.seedRecordIds ?? [],
      reason,
    };
  }

  return {
    kind,
    tableId: resolvedTableId,
    fieldIds,
    recordIds: deadLetter?.seedRecordIds ?? [],
    reason,
  };
};

const findLinkField = (structure: ReproStructure, tableId?: string) => {
  const table = structure.tables.find((entry) => entry.id === tableId);
  return table?.fields.find((field) => field.type === 'link');
};

const isComputedType = (type: string) =>
  type === 'formula' ||
  type === 'lookup' ||
  type === 'rollup' ||
  type === 'conditionalLookup' ||
  type === 'conditionalRollup';

/**
 * A dead-letter row stores the computed *target* fields, not the user's source
 * fields. Derive writable source fields by scanning the target fields' options
 * for field-id references (formula expressions, rollup/lookup wiring).
 */
const deadLetterSourceFields = (
  structure: ReproStructure,
  tableId: string
): string[] | undefined => {
  const table = structure.tables.find((entry) => entry.id === tableId);
  if (!table) return undefined;
  const referenced = new Set<string>();
  for (const field of table.fields) {
    if (isComputedType(field.type)) {
      const serialized = JSON.stringify([field.options ?? null, field.lookupOptions ?? null]);
      for (const candidate of table.fields) {
        if (candidate.id && serialized.includes(candidate.id)) referenced.add(candidate.id);
      }
    }
  }
  const writable = table.fields.filter(
    (field) =>
      field.id && referenced.has(field.id) && !isComputedType(field.type) && field.type !== 'link'
  );
  return writable.length > 0 ? writable.map((field) => field.id!) : undefined;
};

const defaultChangedFields = (table: ReproStructure['tables'][number]): string[] => {
  const writable = table.fields.find(
    (field) =>
      field.type !== 'formula' &&
      field.type !== 'lookup' &&
      field.type !== 'rollup' &&
      field.type !== 'conditionalLookup' &&
      field.type !== 'conditionalRollup' &&
      field.type !== 'link'
  );
  return writable?.id ? [writable.id] : [];
};
