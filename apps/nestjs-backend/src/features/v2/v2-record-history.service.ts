/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable sonarjs/no-identical-functions */
/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ISelectFieldOptions } from '@teable/core';
import { FieldType as CoreFieldType, IdPrefix } from '@teable/core';
import { v2DataDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  FieldId,
  FieldValueTypeVisitor,
  SameTxProjectionHandler,
  RecordUpdated,
  RecordsBatchCreated,
  RecordsBatchUpdated,
  TableQueryService,
  domainError,
  err,
  getUnitOfWorkTransaction,
  ok,
  registerAfterCommit,
  v2CoreTokens,
} from '@teable/v2-core';
import type {
  DomainError,
  Field,
  IEventHandler,
  IExecutionContext,
  IFieldVisitor,
  LinkField,
  MultipleSelectField,
  Result,
  SingleSelectField,
  Table,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { ColumnType, Kysely } from 'kysely';
import { isEqual, isString } from 'lodash';
import { BaseConfig, IBaseConfig } from '../../configs/base.config';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import { V2ContainerService } from './v2-container.service';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from './v2-projection-registrar';

const SELECT_FIELD_TYPE_SET = new Set([CoreFieldType.SingleSelect, CoreFieldType.MultipleSelect]);
const SAME_TX_HISTORY_ROW_BUDGET = 200;
const recordHistoryProjectionLogger = new Logger('V2RecordHistoryProjection');

const stableRecordHistoryId = (parts: {
  eventId: string;
  tableId: string;
  recordId: string;
  fieldId: string;
}): string => {
  const digest = createHash('sha256')
    .update(`${parts.eventId}\0${parts.tableId}\0${parts.recordId}\0${parts.fieldId}`)
    .digest('hex')
    .slice(0, 24);
  return `${IdPrefix.RecordHistory}${digest}`;
};

const resolveHistoryTable = async (
  context: IExecutionContext,
  tableQueryService: TableQueryService,
  tableId: Parameters<TableQueryService['getById']>[1]
): Promise<Table | undefined> => {
  const bound = context.sameTxProjection?.tables.get(tableId.toString()) as Table | undefined;
  if (bound) {
    return bound;
  }
  const tableResult = await tableQueryService.getById(context, tableId);
  if (tableResult.isErr()) {
    recordHistoryProjectionLogger.warn('record_history:table_unavailable', {
      tableId: tableId.toString(),
      errorCode: tableResult.error.code,
    });
    return undefined;
  }
  return tableResult.value;
};

const takeHistoryRows = (
  context: IExecutionContext,
  rows: IRecordHistoryEntry[]
): IRecordHistoryEntry[] | undefined => {
  if (rows.length === 0) {
    return rows;
  }
  const budget = context.sameTxProjection?.historyRowBudget;
  const remaining = budget?.remaining ?? SAME_TX_HISTORY_ROW_BUDGET;
  if (rows.length > remaining) {
    return undefined;
  }
  if (budget) {
    budget.remaining -= rows.length;
  }
  return rows;
};

const emitRecordHistoryCreated = (
  context: IExecutionContext,
  eventEmitterService: EventEmitterService,
  recordIds: string[]
): void => {
  if (recordIds.length === 0) {
    return;
  }
  const emit = () => {
    eventEmitterService.emit(Events.RECORD_HISTORY_CREATE, { recordIds });
  };
  if (registerAfterCommit(context, async () => emit())) {
    return;
  }
  emit();
};

interface IRecordHistoryEntry {
  id: string;
  table_id: string;
  record_id: string;
  field_id: string;
  before: string;
  after: string;
  created_by: string;
}

interface IFieldHistoryMeta {
  type: string;
  name: string;
  options: Record<string, unknown> | null | undefined;
  cellValueType: string;
  isComputed: boolean;
}

type IRecordHistoryDb = V1TeableDatabase & {
  record_history: IRecordHistoryEntry & {
    created_time: ColumnType<Date, Date | undefined, never>;
  };
};

const getRecordHistoryDb = async (
  context: IExecutionContext,
  v2ContainerService: V2ContainerService,
  tableId: string
): Promise<Kysely<IRecordHistoryDb>> => {
  const transaction = getUnitOfWorkTransaction(context, 'data') as
    | { db?: Kysely<IRecordHistoryDb> }
    | undefined;
  if (transaction?.db) {
    return transaction.db;
  }
  const container = await v2ContainerService.getContainerForTable(tableId);
  return container.resolve<Kysely<IRecordHistoryDb>>(v2DataDbTokens.db);
};

const insertRecordHistoryEntries = async (
  db: Kysely<IRecordHistoryDb>,
  recordHistoryList: IRecordHistoryEntry[]
): Promise<void> => {
  if (recordHistoryList.length === 0) {
    return;
  }

  await db
    .insertInto('record_history')
    .values(recordHistoryList)
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
};

/**
 * Visitor to extract field options for record history.
 * Returns options in a format compatible with V1 record history.
 */
class FieldOptionsVisitor implements IFieldVisitor<Record<string, unknown> | null> {
  visitSingleLineTextField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
  visitLongTextField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
  visitNumberField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
  visitRatingField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
  visitFormulaField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
  visitRollupField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
  visitSingleSelectField(
    field: SingleSelectField
  ): Result<Record<string, unknown> | null, DomainError> {
    const choices = field.selectOptions().map((opt) => ({
      id: opt.id().toString(),
      name: opt.name().toString(),
      color: opt.color().toString(),
    }));
    return ok({ choices });
  }
  visitMultipleSelectField(
    field: MultipleSelectField
  ): Result<Record<string, unknown> | null, DomainError> {
    const choices = field.selectOptions().map((opt) => ({
      id: opt.id().toString(),
      name: opt.name().toString(),
      color: opt.color().toString(),
    }));
    return ok({ choices });
  }
  visitCheckboxField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
  visitAttachmentField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
  visitDateField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
  visitCreatedTimeField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
  visitLastModifiedTimeField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
  visitUserField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
  visitCreatedByField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
  visitLastModifiedByField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
  visitAutoNumberField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
  visitButtonField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
  visitLinkField(field: LinkField): Result<Record<string, unknown> | null, DomainError> {
    // foreignTableId keeps the row self-contained for read-time deleted-link marking
    return ok({ foreignTableId: field.foreignTableId().toString() });
  }
  visitLookupField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
  visitConditionalRollupField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
  visitConditionalLookupField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
  }
}

/**
 * Extracts field metadata from V2 Field domain object.
 */
const extractFieldMeta = (field: Field): IFieldHistoryMeta => {
  const type = field.type().toString();
  const name = field.name().toString();
  const isComputed = field.computed().toBoolean();

  // Get cellValueType via visitor
  const valueTypeResult = field.accept(new FieldValueTypeVisitor());
  const cellValueType = valueTypeResult.isOk()
    ? valueTypeResult.value.cellValueType.toString()
    : 'string';

  // Get options via visitor
  const optionsResult = field.accept(new FieldOptionsVisitor());
  const options = optionsResult.isOk() ? optionsResult.value : null;

  return { type, name, options, cellValueType, isComputed };
};

/**
 * Minimizes field options for select fields to only include choices that match the value.
 */
const minimizeFieldOptions = (
  value: unknown,
  meta: IFieldHistoryMeta
): Record<string, unknown> | null | undefined => {
  const { type, options: _options } = meta;

  if (SELECT_FIELD_TYPE_SET.has(type as CoreFieldType) && _options) {
    const options = _options as ISelectFieldOptions;
    const { choices } = options;

    if (value == null) {
      return { ...options, choices: [] };
    }

    if (isString(value)) {
      return { ...options, choices: choices.filter(({ name }) => name === value) };
    }

    if (Array.isArray(value)) {
      const valueSet = new Set(value);
      return { ...options, choices: choices.filter(({ name }) => valueSet.has(name)) };
    }
  }

  return _options;
};

/**
 * Builds the history entry JSON structure for before/after values.
 */
const buildHistoryValue = (
  value: unknown,
  meta: IFieldHistoryMeta
): { meta: object; data: unknown } => ({
  meta: {
    type: meta.type,
    name: meta.name,
    options: minimizeFieldOptions(value, meta),
    cellValueType: meta.cellValueType,
  },
  data: value,
});

/**
 * RecordCreated / RecordsDeleted history is intentionally not migrated:
 * v1 had no handlers for those events. Do not treat them as same-tx durable.
 *
 * V2 projection handler that writes record history for individual record update events.
 */
@SameTxProjectionHandler(RecordUpdated, {
  id: 'teable.host.record-history.record-updated',
})
export class V2RecordUpdatedHistoryProjection implements IEventHandler<RecordUpdated> {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly baseConfig: IBaseConfig,
    private readonly tableQueryService: TableQueryService,
    private readonly eventEmitterService: EventEmitterService
  ) {}

  async handle(
    context: IExecutionContext,
    event: RecordUpdated
  ): Promise<Result<void, DomainError>> {
    if (this.baseConfig.recordHistoryDisabled) {
      return ok(undefined);
    }

    if (event.source === 'computed') {
      return ok(undefined);
    }

    if (event.changes.length === 0) {
      return ok(undefined);
    }

    return this.writeRecordUpdatedHistory(context, event);
  }

  private async writeRecordUpdatedHistory(
    context: IExecutionContext,
    event: RecordUpdated
  ): Promise<Result<void, DomainError>> {
    const tableIdStr = event.tableId.toString();
    const recordId = event.recordId.toString();
    const userId = context.actorId.toString();
    const eventId = context.sameTxProjection?.eventId ?? `${tableIdStr}:${recordId}`;

    const table = await resolveHistoryTable(context, this.tableQueryService, event.tableId);
    if (!table) {
      return ok(undefined);
    }

    const fieldMetaMap = new Map<string, IFieldHistoryMeta>();
    for (const change of event.changes) {
      const fieldIdResult = FieldId.create(change.fieldId);
      if (fieldIdResult.isErr()) continue;

      const fieldResult = table.getField((f) => f.id().equals(fieldIdResult.value));
      if (fieldResult.isOk()) {
        fieldMetaMap.set(change.fieldId, extractFieldMeta(fieldResult.value));
      }
    }

    const recordHistoryList: IRecordHistoryEntry[] = [];

    for (const change of event.changes) {
      const meta = fieldMetaMap.get(change.fieldId);
      if (!meta) continue;
      if (isEqual(change.oldValue, change.newValue)) continue;
      if (meta.isComputed) continue;

      recordHistoryList.push({
        id: stableRecordHistoryId({
          eventId,
          tableId: tableIdStr,
          recordId,
          fieldId: change.fieldId,
        }),
        table_id: tableIdStr,
        record_id: recordId,
        field_id: change.fieldId,
        before: JSON.stringify(buildHistoryValue(change.oldValue, meta)),
        after: JSON.stringify(buildHistoryValue(change.newValue, meta)),
        created_by: userId as string,
      });
    }

    const rows = takeHistoryRows(context, recordHistoryList);
    if (!rows) {
      return ok(undefined);
    }

    try {
      const db = await getRecordHistoryDb(context, this.v2ContainerService, tableIdStr);
      await insertRecordHistoryEntries(db, rows);
    } catch (error) {
      return err(
        domainError.infrastructure({
          code: 'record_history.insert_failed',
          message: error instanceof Error ? error.message : 'Failed to insert record history',
        })
      );
    }

    emitRecordHistoryCreated(context, this.eventEmitterService, [recordId]);
    return ok(undefined);
  }
}

/**
 * V2 projection handler that writes record history for batch record creation events.
 * Paste and API batch creates write history to the routed v2 data DB. Import and
 * table-duplicate batches are skipped: created cells carry no information beyond the
 * record itself (`__created_by`/`__created_time` already cover attribution), and large
 * batches would otherwise write rows × non-empty-cells history entries. For duplicate
 * this also keeps the hydrated fallback path consistent with the physical bulk path,
 * which emits empty field payloads and never wrote history.
 */
@SameTxProjectionHandler(RecordsBatchCreated, {
  id: 'teable.host.record-history.records-batch-created',
})
export class V2RecordsBatchCreatedHistoryProjection implements IEventHandler<RecordsBatchCreated> {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly baseConfig: IBaseConfig,
    private readonly tableQueryService: TableQueryService,
    private readonly eventEmitterService: EventEmitterService
  ) {}

  async handle(
    context: IExecutionContext,
    event: RecordsBatchCreated
  ): Promise<Result<void, DomainError>> {
    if (this.baseConfig.recordHistoryDisabled) {
      return ok(undefined);
    }

    if (event.source.type === 'import' || event.source.type === 'tableDuplicate') {
      return ok(undefined);
    }

    const fieldIdSet = new Set<string>();
    for (const record of event.records) {
      for (const field of record.fields) {
        fieldIdSet.add(field.fieldId);
      }
    }

    if (fieldIdSet.size === 0) {
      return ok(undefined);
    }

    return this.writeRecordsBatchCreatedHistory(context, event, fieldIdSet);
  }

  private async writeRecordsBatchCreatedHistory(
    context: IExecutionContext,
    event: RecordsBatchCreated,
    fieldIdSet: Set<string>
  ): Promise<Result<void, DomainError>> {
    const tableIdStr = event.tableId.toString();
    const userId = context.actorId.toString();
    const eventId = context.sameTxProjection?.eventId ?? tableIdStr;

    const table = await resolveHistoryTable(context, this.tableQueryService, event.tableId);
    if (!table) {
      return ok(undefined);
    }

    const fieldMetaMap = new Map<string, IFieldHistoryMeta>();
    for (const fieldIdStr of fieldIdSet) {
      const fieldIdResult = FieldId.create(fieldIdStr);
      if (fieldIdResult.isErr()) continue;

      const fieldResult = table.getField((f) => f.id().equals(fieldIdResult.value));
      if (fieldResult.isOk()) {
        fieldMetaMap.set(fieldIdStr, extractFieldMeta(fieldResult.value));
      }
    }

    const recordHistoryList: IRecordHistoryEntry[] = [];
    const recordIds: string[] = [];

    for (const record of event.records) {
      recordIds.push(record.recordId);

      for (const field of record.fields) {
        const value = field.value;
        if (value === '' || value == null) continue;

        const meta = fieldMetaMap.get(field.fieldId);
        if (!meta || meta.isComputed) continue;

        recordHistoryList.push({
          id: stableRecordHistoryId({
            eventId,
            tableId: tableIdStr,
            recordId: record.recordId,
            fieldId: field.fieldId,
          }),
          table_id: tableIdStr,
          record_id: record.recordId,
          field_id: field.fieldId,
          before: JSON.stringify(buildHistoryValue(null, meta)),
          after: JSON.stringify(buildHistoryValue(value, meta)),
          created_by: userId as string,
        });
      }
    }

    const rows = takeHistoryRows(context, recordHistoryList);
    if (!rows) {
      return ok(undefined);
    }

    try {
      const db = await getRecordHistoryDb(context, this.v2ContainerService, tableIdStr);
      await insertRecordHistoryEntries(db, rows);
    } catch (error) {
      return err(
        domainError.infrastructure({
          code: 'record_history.insert_failed',
          message: error instanceof Error ? error.message : 'Failed to insert record history',
        })
      );
    }

    emitRecordHistoryCreated(context, this.eventEmitterService, recordIds);
    return ok(undefined);
  }
}

/**
 * V2 projection handler that writes record history for batch record update events.
 * RecordsBatchUpdated is used by paste operations.
 */
@SameTxProjectionHandler(RecordsBatchUpdated, {
  id: 'teable.host.record-history.records-batch-updated',
})
export class V2RecordsBatchUpdatedHistoryProjection implements IEventHandler<RecordsBatchUpdated> {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly baseConfig: IBaseConfig,
    private readonly tableQueryService: TableQueryService,
    private readonly eventEmitterService: EventEmitterService
  ) {}

  async handle(
    context: IExecutionContext,
    event: RecordsBatchUpdated
  ): Promise<Result<void, DomainError>> {
    if (this.baseConfig.recordHistoryDisabled) {
      return ok(undefined);
    }

    if (event.source === 'computed') {
      return ok(undefined);
    }

    const fieldIdSet = new Set<string>();
    for (const update of event.updates) {
      for (const change of update.changes) {
        fieldIdSet.add(change.fieldId);
      }
    }

    if (fieldIdSet.size === 0) {
      return ok(undefined);
    }

    return this.writeRecordsBatchUpdatedHistory(context, event, fieldIdSet);
  }

  private async writeRecordsBatchUpdatedHistory(
    context: IExecutionContext,
    event: RecordsBatchUpdated,
    fieldIdSet: Set<string>
  ): Promise<Result<void, DomainError>> {
    const tableIdStr = event.tableId.toString();
    const userId = context.actorId.toString();
    const eventId = context.sameTxProjection?.eventId ?? tableIdStr;

    const table = await resolveHistoryTable(context, this.tableQueryService, event.tableId);
    if (!table) {
      return ok(undefined);
    }

    const fieldMetaMap = new Map<string, IFieldHistoryMeta>();
    for (const fieldIdStr of fieldIdSet) {
      const fieldIdResult = FieldId.create(fieldIdStr);
      if (fieldIdResult.isErr()) continue;

      const fieldResult = table.getField((f) => f.id().equals(fieldIdResult.value));
      if (fieldResult.isOk()) {
        fieldMetaMap.set(fieldIdStr, extractFieldMeta(fieldResult.value));
      }
    }

    const recordHistoryList: IRecordHistoryEntry[] = [];
    const recordIds: string[] = [];

    for (const update of event.updates) {
      const recordId = update.recordId;
      recordIds.push(recordId);

      for (const change of update.changes) {
        const meta = fieldMetaMap.get(change.fieldId);
        if (!meta) continue;
        if (isEqual(change.oldValue, change.newValue)) continue;
        if (meta.isComputed) continue;

        recordHistoryList.push({
          id: stableRecordHistoryId({
            eventId,
            tableId: tableIdStr,
            recordId,
            fieldId: change.fieldId,
          }),
          table_id: tableIdStr,
          record_id: recordId,
          field_id: change.fieldId,
          before: JSON.stringify(buildHistoryValue(change.oldValue, meta)),
          after: JSON.stringify(buildHistoryValue(change.newValue, meta)),
          created_by: userId as string,
        });
      }
    }

    const rows = takeHistoryRows(context, recordHistoryList);
    if (!rows) {
      return ok(undefined);
    }

    try {
      const db = await getRecordHistoryDb(context, this.v2ContainerService, tableIdStr);
      await insertRecordHistoryEntries(db, rows);
    } catch (error) {
      return err(
        domainError.infrastructure({
          code: 'record_history.insert_failed',
          message: error instanceof Error ? error.message : 'Failed to insert record history',
        })
      );
    }

    emitRecordHistoryCreated(context, this.eventEmitterService, recordIds);
    return ok(undefined);
  }
}

/**
 * Service that registers V2 record history projections with the V2 container.
 * These projections write record history to the database when records are updated.
 */
@V2ProjectionRegistrar()
@Injectable()
export class V2RecordHistoryService implements IV2ProjectionRegistrar {
  private readonly logger = new Logger(V2RecordHistoryService.name);

  constructor(
    private readonly v2ContainerService: V2ContainerService,
    @BaseConfig() private readonly baseConfig: IBaseConfig,
    private readonly eventEmitterService: EventEmitterService
  ) {}

  /**
   * Register record history projections with the V2 container.
   */
  registerProjections(container: DependencyContainer): void {
    this.logger.log('Registering V2 record history projections');

    // Resolve TableQueryService from V2 container
    const tableQueryService = container.resolve<TableQueryService>(v2CoreTokens.tableQueryService);

    // Register projection instances with services
    container.registerInstance(
      V2RecordUpdatedHistoryProjection,
      new V2RecordUpdatedHistoryProjection(
        this.v2ContainerService,
        this.baseConfig,
        tableQueryService,
        this.eventEmitterService
      )
    );

    container.registerInstance(
      V2RecordsBatchCreatedHistoryProjection,
      new V2RecordsBatchCreatedHistoryProjection(
        this.v2ContainerService,
        this.baseConfig,
        tableQueryService,
        this.eventEmitterService
      )
    );

    container.registerInstance(
      V2RecordsBatchUpdatedHistoryProjection,
      new V2RecordsBatchUpdatedHistoryProjection(
        this.v2ContainerService,
        this.baseConfig,
        tableQueryService,
        this.eventEmitterService
      )
    );
  }
}
