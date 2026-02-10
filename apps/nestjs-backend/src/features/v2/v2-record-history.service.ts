/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable sonarjs/no-identical-functions */
/* eslint-disable @typescript-eslint/naming-convention */
import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { ISelectFieldOptions } from '@teable/core';
import { FieldType as CoreFieldType, generateRecordHistoryId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  FieldId,
  FieldValueTypeVisitor,
  ProjectionHandler,
  RecordUpdated,
  RecordsBatchUpdated,
  TableQueryService,
  ok,
  v2CoreTokens,
} from '@teable/v2-core';
import type {
  DomainError,
  Field,
  IEventHandler,
  IExecutionContext,
  IFieldVisitor,
  MultipleSelectField,
  Result,
  SingleSelectField,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Knex } from 'knex';
import { isEqual, isString } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { BaseConfig, IBaseConfig } from '../../configs/base.config';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';
import { V2ContainerService } from './v2-container.service';
import type { IV2ProjectionRegistrar } from './v2-projection-registrar';

const SELECT_FIELD_TYPE_SET = new Set([CoreFieldType.SingleSelect, CoreFieldType.MultipleSelect]);

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
  visitLinkField(): Result<Record<string, unknown> | null, DomainError> {
    return ok(null);
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
 * V2 projection handler that writes record history for individual record update events.
 */
@ProjectionHandler(RecordUpdated)
class V2RecordUpdatedHistoryProjection implements IEventHandler<RecordUpdated> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly baseConfig: IBaseConfig,
    private readonly knex: Knex,
    private readonly tableQueryService: TableQueryService,
    private readonly eventEmitterService: EventEmitterService
  ) {}

  async handle(
    context: IExecutionContext,
    event: RecordUpdated
  ): Promise<Result<void, DomainError>> {
    // Check if record history is disabled
    if (this.baseConfig.recordHistoryDisabled) {
      return ok(undefined);
    }

    // Skip computed updates - we only track user-initiated changes
    if (event.source === 'computed') {
      return ok(undefined);
    }

    const tableIdStr = event.tableId.toString();
    const recordId = event.recordId.toString();
    const userId = this.cls.get('user.id');

    // Get field IDs from changes
    if (event.changes.length === 0) {
      return ok(undefined);
    }

    // Load table from V2 domain
    const tableResult = await this.tableQueryService.getById(context, event.tableId);
    if (tableResult.isErr()) {
      return ok(undefined); // Silently skip if table not found
    }
    const table = tableResult.value;

    // Build field metadata map
    const fieldMetaMap = new Map<string, IFieldHistoryMeta>();
    for (const change of event.changes) {
      const fieldIdResult = FieldId.create(change.fieldId);
      if (fieldIdResult.isErr()) continue;

      const fieldResult = table.getField((f) => f.id().equals(fieldIdResult.value));
      if (fieldResult.isOk()) {
        fieldMetaMap.set(change.fieldId, extractFieldMeta(fieldResult.value));
      }
    }

    // Build history entries
    const recordHistoryList: IRecordHistoryEntry[] = [];

    for (const change of event.changes) {
      const meta = fieldMetaMap.get(change.fieldId);
      if (!meta) continue;

      // Skip no-op changes
      if (isEqual(change.oldValue, change.newValue)) continue;

      // Skip computed fields
      if (meta.isComputed) continue;

      recordHistoryList.push({
        id: generateRecordHistoryId(),
        table_id: tableIdStr,
        record_id: recordId,
        field_id: change.fieldId,
        before: JSON.stringify(buildHistoryValue(change.oldValue, meta)),
        after: JSON.stringify(buildHistoryValue(change.newValue, meta)),
        created_by: userId as string,
      });
    }

    // Insert history records
    if (recordHistoryList.length > 0) {
      const query = this.knex.insert(recordHistoryList).into('record_history').toQuery();
      await this.prisma.$executeRawUnsafe(query);
    }

    // Emit RECORD_HISTORY_CREATE event for compatibility
    this.eventEmitterService.emit(Events.RECORD_HISTORY_CREATE, {
      recordIds: [recordId],
    });

    return ok(undefined);
  }
}

/**
 * V2 projection handler that writes record history for batch record update events.
 * RecordsBatchUpdated is used by paste operations.
 */
@ProjectionHandler(RecordsBatchUpdated)
class V2RecordsBatchUpdatedHistoryProjection implements IEventHandler<RecordsBatchUpdated> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly baseConfig: IBaseConfig,
    private readonly knex: Knex,
    private readonly tableQueryService: TableQueryService,
    private readonly eventEmitterService: EventEmitterService
  ) {}

  async handle(
    context: IExecutionContext,
    event: RecordsBatchUpdated
  ): Promise<Result<void, DomainError>> {
    // Check if record history is disabled
    if (this.baseConfig.recordHistoryDisabled) {
      return ok(undefined);
    }

    // Skip computed updates
    if (event.source === 'computed') {
      return ok(undefined);
    }

    const tableIdStr = event.tableId.toString();
    const userId = this.cls.get('user.id');

    // Collect all field IDs from all updates
    const fieldIdSet = new Set<string>();
    for (const update of event.updates) {
      for (const change of update.changes) {
        fieldIdSet.add(change.fieldId);
      }
    }

    if (fieldIdSet.size === 0) {
      return ok(undefined);
    }

    // Load table from V2 domain
    const tableResult = await this.tableQueryService.getById(context, event.tableId);
    if (tableResult.isErr()) {
      return ok(undefined); // Silently skip if table not found
    }
    const table = tableResult.value;

    // Build field metadata map
    const fieldMetaMap = new Map<string, IFieldHistoryMeta>();
    for (const fieldIdStr of fieldIdSet) {
      const fieldIdResult = FieldId.create(fieldIdStr);
      if (fieldIdResult.isErr()) continue;

      const fieldResult = table.getField((f) => f.id().equals(fieldIdResult.value));
      if (fieldResult.isOk()) {
        fieldMetaMap.set(fieldIdStr, extractFieldMeta(fieldResult.value));
      }
    }

    // Build history entries for all updates
    const recordHistoryList: IRecordHistoryEntry[] = [];
    const recordIds: string[] = [];

    const batchSize = 5000;

    for (const update of event.updates) {
      const recordId = update.recordId;
      recordIds.push(recordId);

      for (const change of update.changes) {
        const meta = fieldMetaMap.get(change.fieldId);
        if (!meta) continue;

        // Skip no-op changes
        if (isEqual(change.oldValue, change.newValue)) continue;

        // Skip computed fields
        if (meta.isComputed) continue;

        recordHistoryList.push({
          id: generateRecordHistoryId(),
          table_id: tableIdStr,
          record_id: recordId,
          field_id: change.fieldId,
          before: JSON.stringify(buildHistoryValue(change.oldValue, meta)),
          after: JSON.stringify(buildHistoryValue(change.newValue, meta)),
          created_by: userId as string,
        });
      }
    }

    // Insert history records in batches
    for (let i = 0; i < recordHistoryList.length; i += batchSize) {
      const batch = recordHistoryList.slice(i, i + batchSize);
      if (batch.length > 0) {
        const query = this.knex.insert(batch).into('record_history').toQuery();
        await this.prisma.$executeRawUnsafe(query);
      }
    }

    // Emit RECORD_HISTORY_CREATE event for compatibility
    if (recordIds.length > 0) {
      this.eventEmitterService.emit(Events.RECORD_HISTORY_CREATE, {
        recordIds,
      });
    }

    return ok(undefined);
  }
}

/**
 * Service that registers V2 record history projections with the V2 container.
 * These projections write record history to the database when records are updated.
 */
@Injectable()
export class V2RecordHistoryService implements IV2ProjectionRegistrar, OnModuleInit {
  private readonly logger = new Logger(V2RecordHistoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    @BaseConfig() private readonly baseConfig: IBaseConfig,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    private readonly eventEmitterService: EventEmitterService,
    private readonly v2ContainerService: V2ContainerService
  ) {}

  /**
   * Register this service with V2ContainerService on module initialization.
   */
  onModuleInit(): void {
    this.v2ContainerService.addProjectionRegistrar(this);
  }

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
        this.prisma,
        this.cls,
        this.baseConfig,
        this.knex,
        tableQueryService,
        this.eventEmitterService
      )
    );

    container.registerInstance(
      V2RecordsBatchUpdatedHistoryProjection,
      new V2RecordsBatchUpdatedHistoryProjection(
        this.prisma,
        this.cls,
        this.baseConfig,
        this.knex,
        tableQueryService,
        this.eventEmitterService
      )
    );
  }
}
