import { Injectable, Logger } from '@nestjs/common';
import {
  CellValueType,
  DbFieldType,
  FieldType,
  ViewOpBuilder,
  ViewType,
  generateOperationId,
  getDbFieldType,
  type IFieldVo,
  type IGridColumnMeta,
  type IGridViewOptions,
  type IOtOperation,
} from '@teable/core';
import { ResourceType } from '@teable/openapi';
import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { domainError, ok, v2CoreTokens } from '@teable/v2-core';
import type {
  DomainError,
  FieldDeleteSnapshotSinkInput,
  FieldDeleteSnapshotItem,
  IExecutionContext,
  IFieldDeleteSnapshotSink,
  IFieldDeleteSnapshotSinkCompletion,
  ITableFieldPersistenceDTO,
  ITableMapper,
  ITablePersistenceDTO,
  Result,
  UndoRedoFieldSnapshot,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { err } from 'neverthrow';
import { adjustFrozenField } from '../view/utils/derive-frozen-fields';
import { V2ContainerService } from './v2-container.service';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from './v2-projection-registrar';
import { V2ViewCompatService } from './v2-view-compat.service';

/* eslint-disable @typescript-eslint/naming-convention */
type IV2FieldDeleteCompatDb = V1TeableDatabase & {
  table_trash: {
    id: string;
    table_id: string;
    resource_type: string;
    snapshot: string;
    created_by: string;
  };
};
/* eslint-enable @typescript-eslint/naming-convention */

type IReferenceRow = Pick<IV2FieldDeleteCompatDb['reference'], 'from_field_id' | 'to_field_id'>;

type ILegacyColumnMeta = NonNullable<UndoRedoFieldSnapshot['views'][number]['columnMeta']>;

type ILegacyDeletedField = Omit<IFieldVo, 'columnMeta'> & {
  columnMeta?: Record<string, ILegacyColumnMeta>;
  references?: string[];
};

type ILegacyDeleteFieldsPayloadSnapshot = {
  fields: ILegacyDeletedField[];
  records?: Array<{ id: string; fields: Record<string, unknown> }>;
};

type ILegacyLookupOptions = NonNullable<IFieldVo['lookupOptions']>;
type ILegacyConditionalLookupOptions = Extract<ILegacyLookupOptions, { filter: unknown }>;

type ISnapshotFieldExtra = {
  isMultipleCellValue?: boolean;
  isLookup?: boolean;
  isConditionalLookup?: boolean;
  lookupOptions?: IFieldVo['lookupOptions'];
};

type IFieldDtoExtra = {
  cellValueType?: string;
  isMultipleCellValue?: boolean;
  meta?: unknown;
  options?: unknown;
  aiConfig?: unknown;
  lookupOptions?: unknown;
};

type IV2FieldDeleteCompatCompletionInput = {
  tableId: string;
  userId: string;
  operationId: string;
  frozenFieldOps: Record<string, IOtOperation[]>;
  snapshots: ReadonlyArray<FieldDeleteSnapshotItem>;
  referencesByFieldId: ReadonlyMap<string, ReadonlyArray<string>>;
};

const cellValueTypeFromFieldType = (fieldType: string, fallback?: string): CellValueType => {
  if (Object.values(CellValueType).includes(fallback as CellValueType)) {
    return fallback as CellValueType;
  }

  switch (fieldType) {
    case FieldType.Number:
    case FieldType.Rating:
    case FieldType.AutoNumber:
      return CellValueType.Number;
    case FieldType.Checkbox:
      return CellValueType.Boolean;
    case FieldType.Date:
    case FieldType.CreatedTime:
    case FieldType.LastModifiedTime:
      return CellValueType.DateTime;
    default:
      return CellValueType.String;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const fieldDtoExtra = (fieldDto: ITableFieldPersistenceDTO): IFieldDtoExtra =>
  fieldDto as IFieldDtoExtra;

const snapshotFieldExtra = (snapshot: UndoRedoFieldSnapshot): ISnapshotFieldExtra =>
  snapshot.field as ISnapshotFieldExtra;

const fieldDescription = (fieldDto: ITableFieldPersistenceDTO): string | undefined =>
  fieldDto.description ?? undefined;

const fieldOptions = (fieldDto: ITableFieldPersistenceDTO): IFieldVo['options'] => {
  const options = fieldDtoExtra(fieldDto).options;
  return (isRecord(options) ? options : {}) as IFieldVo['options'];
};

const fieldMeta = (fieldDto: ITableFieldPersistenceDTO): IFieldVo['meta'] =>
  fieldDtoExtra(fieldDto).meta as IFieldVo['meta'];

const fieldAiConfig = (fieldDto: ITableFieldPersistenceDTO): IFieldVo['aiConfig'] =>
  fieldDtoExtra(fieldDto).aiConfig as IFieldVo['aiConfig'];

const fieldLookupOptions = (fieldDto: ITableFieldPersistenceDTO): IFieldVo['lookupOptions'] => {
  const lookupOptions = fieldDtoExtra(fieldDto).lookupOptions;
  return isRecord(lookupOptions) ? (lookupOptions as IFieldVo['lookupOptions']) : undefined;
};

const conditionalLookupLegacyOptions = (
  options: Record<string, unknown>
): IFieldVo['lookupOptions'] => {
  const condition = isRecord(options.condition) ? options.condition : undefined;
  const lookupOptions = {
    ...(typeof options.foreignTableId === 'string'
      ? { foreignTableId: options.foreignTableId }
      : {}),
    ...(typeof options.lookupFieldId === 'string' ? { lookupFieldId: options.lookupFieldId } : {}),
    ...(condition?.filter !== undefined
      ? { filter: condition.filter as ILegacyConditionalLookupOptions['filter'] }
      : {}),
    ...(condition?.sort !== undefined
      ? { sort: condition.sort as ILegacyConditionalLookupOptions['sort'] }
      : {}),
    ...(typeof condition?.limit === 'number' ? { limit: condition.limit } : {}),
  };

  return Object.keys(lookupOptions).length > 0
    ? (lookupOptions as ILegacyLookupOptions)
    : undefined;
};

const legacyFieldFromDto = (
  fieldDto: ITableFieldPersistenceDTO,
  snapshot: UndoRedoFieldSnapshot
): IFieldVo => {
  if (fieldDto.type === 'conditionalLookup') {
    const options = isRecord(fieldDto.options) ? fieldDto.options : {};
    const innerType = (fieldDto.innerType ?? FieldType.SingleLineText) as IFieldVo['type'];
    return legacyFieldFromDto(
      {
        ...fieldDto,
        type: innerType as ITableFieldPersistenceDTO['type'],
        options: fieldDto.innerOptions as ITableFieldPersistenceDTO['options'],
      } as ITableFieldPersistenceDTO,
      {
        ...snapshot,
        field: {
          ...snapshot.field,
          type: innerType,
          isLookup: true,
          isConditionalLookup: true,
          lookupOptions: conditionalLookupLegacyOptions(options),
        } as unknown as UndoRedoFieldSnapshot['field'],
      }
    );
  }

  const type = fieldDto.type as FieldType;
  const extra = fieldDtoExtra(fieldDto);
  const snapshotExtra = snapshotFieldExtra(snapshot);
  const cellValueType = cellValueTypeFromFieldType(fieldDto.type, extra.cellValueType);
  const isMultipleCellValue = extra.isMultipleCellValue ?? snapshotExtra.isMultipleCellValue;
  const dbFieldType = Object.values(DbFieldType).includes(fieldDto.dbFieldType as DbFieldType)
    ? (fieldDto.dbFieldType as DbFieldType)
    : getDbFieldType(type, cellValueType, isMultipleCellValue);

  return {
    id: fieldDto.id,
    name: fieldDto.name,
    type,
    description: fieldDescription(fieldDto),
    options: fieldOptions(fieldDto),
    meta: fieldMeta(fieldDto),
    aiConfig: fieldAiConfig(fieldDto),
    isLookup: snapshotExtra.isLookup,
    isConditionalLookup: snapshotExtra.isConditionalLookup,
    lookupOptions: snapshotExtra.lookupOptions ?? fieldLookupOptions(fieldDto),
    notNull: fieldDto.notNull,
    unique: fieldDto.unique,
    isPrimary: snapshot.field.isPrimary,
    isComputed: fieldDto.isComputed,
    hasError: fieldDto.hasError,
    cellValueType,
    isMultipleCellValue,
    dbFieldType,
    dbFieldName: fieldDto.dbFieldName ?? fieldDto.id,
  };
};

const legacyRecordsFromSnapshots = (
  snapshots: ReadonlyArray<FieldDeleteSnapshotItem>
): ILegacyDeleteFieldsPayloadSnapshot['records'] => {
  const recordsById = new Map<string, { id: string; fields: Record<string, unknown> }>();

  for (const { snapshot } of snapshots) {
    const fieldId = snapshot.field.id;
    for (const record of snapshot.records ?? []) {
      const item = recordsById.get(record.recordId) ?? { id: record.recordId, fields: {} };
      item.fields[fieldId] = record.value;
      recordsById.set(record.recordId, item);
    }
  }

  return recordsById.size > 0 ? [...recordsById.values()] : undefined;
};

const legacyPayloadFromSnapshots = (
  tableMapper: ITableMapper,
  snapshots: ReadonlyArray<FieldDeleteSnapshotItem>,
  referencesByFieldId: ReadonlyMap<string, ReadonlyArray<string>>
): Result<ILegacyDeleteFieldsPayloadSnapshot, DomainError> => {
  const fields: ILegacyDeleteFieldsPayloadSnapshot['fields'] = [];
  const fieldIds = snapshots.map(({ snapshot }) => snapshot.field.id);
  const tableDtoByTable = new WeakMap<FieldDeleteSnapshotItem['table'], ITablePersistenceDTO>();

  for (const { table, snapshot } of snapshots) {
    let tableDto = tableDtoByTable.get(table);
    if (!tableDto) {
      const tableDtoResult = tableMapper.toDTO(table);
      if (tableDtoResult.isErr()) {
        return err(tableDtoResult.error);
      }
      tableDto = tableDtoResult.value;
      tableDtoByTable.set(table, tableDto);
    }

    const fieldDto = tableDto.fields.find((candidate) => candidate.id === snapshot.field.id);
    if (!fieldDto) {
      return err(domainError.notFound({ message: 'Field snapshot source not found' }));
    }

    const columnMeta: Record<string, ILegacyColumnMeta> = Object.fromEntries(
      snapshot.views.flatMap((view) =>
        view.columnMeta == null ? [] : [[view.viewId, view.columnMeta]]
      )
    );

    fields.push({
      ...legacyFieldFromDto(fieldDto, snapshot),
      ...(Object.keys(columnMeta).length > 0 ? { columnMeta } : {}),
      references: [...fieldIds, ...(referencesByFieldId.get(snapshot.field.id) ?? [])],
    });
  }

  return ok({
    fields,
    records: legacyRecordsFromSnapshots(snapshots),
  });
};

const buildFrozenFieldDeleteOps = (
  tableMapper: ITableMapper,
  snapshots: ReadonlyArray<FieldDeleteSnapshotItem>,
  fieldIds: ReadonlyArray<string>
): Result<Record<string, IOtOperation[]>, DomainError> => {
  const fieldIdSet = new Set(fieldIds);
  const opsMap: Record<string, IOtOperation[]> = {};

  for (const { table, snapshot } of snapshots) {
    const tableDtoResult = tableMapper.toDTO(table);
    if (tableDtoResult.isErr()) {
      return err(tableDtoResult.error);
    }

    for (const view of tableDtoResult.value.views) {
      if (view.type !== ViewType.Grid || opsMap[view.id]) {
        continue;
      }

      const columnMetaUpdate = Object.fromEntries(
        [...fieldIdSet].map((fieldId) => [fieldId, null])
      );
      const nextOptions = adjustFrozenField(
        (view.options ?? {}) as IGridViewOptions,
        view.columnMeta as IGridColumnMeta,
        columnMetaUpdate as unknown as IGridColumnMeta
      );
      if (!nextOptions) {
        continue;
      }

      opsMap[view.id] = [
        ViewOpBuilder.editor.setViewProperty.build({
          key: 'options',
          oldValue: view.options ?? {},
          newValue: nextOptions,
        }),
      ];
    }
  }

  return ok(opsMap);
};

const getReferencesByFieldId = (
  references: ReadonlyArray<IReferenceRow>
): ReadonlyMap<string, ReadonlyArray<string>> => {
  const referencesByFieldId = new Map<string, string[]>();
  for (const reference of references) {
    const values = referencesByFieldId.get(reference.from_field_id) ?? [];
    values.push(reference.to_field_id);
    referencesByFieldId.set(reference.from_field_id, values);
  }
  return referencesByFieldId;
};

export class V2FieldDeleteCompatCompletion implements IFieldDeleteSnapshotSinkCompletion {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ViewCompatService: V2ViewCompatService,
    private readonly input: IV2FieldDeleteCompatCompletionInput
  ) {}

  async complete(context: IExecutionContext): Promise<Result<void, DomainError>> {
    if (Object.keys(this.input.frozenFieldOps).length > 0) {
      await this.v2ViewCompatService.batchUpdateViewByOps(
        this.input.tableId,
        this.input.frozenFieldOps,
        context
      );
    }

    const container = await this.v2ContainerService.getContainerForTable(this.input.tableId);
    const db = container.resolve<Kysely<IV2FieldDeleteCompatDb>>(v2DataDbTokens.db);
    const tableMapper = container.resolve<ITableMapper>(v2CoreTokens.tableMapper);
    const legacyPayloadResult = legacyPayloadFromSnapshots(
      tableMapper,
      this.input.snapshots,
      this.input.referencesByFieldId
    );
    if (legacyPayloadResult.isErr()) {
      return err(legacyPayloadResult.error);
    }
    const legacyPayload = legacyPayloadResult.value;

    await db
      .insertInto('table_trash')
      .values({
        id: this.input.operationId,
        table_id: this.input.tableId,
        created_by: this.input.userId,
        resource_type: ResourceType.Field,
        snapshot: JSON.stringify({
          fields: legacyPayload.fields,
          records: legacyPayload.records,
        }),
      })
      .execute();

    return ok(undefined);
  }
}

export class V2FieldDeleteSnapshotSink implements IFieldDeleteSnapshotSink {
  constructor(
    private readonly tableMapper: ITableMapper,
    private readonly metaDb: Kysely<IV2FieldDeleteCompatDb>,
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ViewCompatService: V2ViewCompatService
  ) {}

  async prepare(
    context: IExecutionContext,
    input: FieldDeleteSnapshotSinkInput
  ): Promise<Result<IFieldDeleteSnapshotSinkCompletion | undefined, DomainError>> {
    const frozenFieldOpsResult = buildFrozenFieldDeleteOps(
      this.tableMapper,
      input.snapshots,
      input.fieldIds
    );
    if (frozenFieldOpsResult.isErr()) {
      return err(frozenFieldOpsResult.error);
    }
    const references = await this.metaDb
      .selectFrom('reference')
      .select(['from_field_id', 'to_field_id'])
      .where('from_field_id', 'in', [...input.fieldIds])
      .execute();

    return ok(
      new V2FieldDeleteCompatCompletion(this.v2ContainerService, this.v2ViewCompatService, {
        tableId: input.tableId,
        userId: context.actorId.toString(),
        operationId: generateOperationId(),
        frozenFieldOps: frozenFieldOpsResult.value,
        snapshots: [...input.snapshots],
        referencesByFieldId: getReferencesByFieldId(references),
      })
    );
  }
}

@V2ProjectionRegistrar()
@Injectable()
export class V2FieldDeleteCompatService implements IV2ProjectionRegistrar {
  private readonly logger = new Logger(V2FieldDeleteCompatService.name);

  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ViewCompatService: V2ViewCompatService
  ) {}

  registerProjections(container: DependencyContainer): void {
    this.logger.debug('Registering V2 field delete compatibility projections');
    const tableMapper = container.resolve<ITableMapper>(v2CoreTokens.tableMapper);
    const metaDb = container.resolve<Kysely<IV2FieldDeleteCompatDb>>(v2MetaDbTokens.db);
    container.registerInstance(
      v2CoreTokens.fieldDeleteSnapshotSink,
      new V2FieldDeleteSnapshotSink(
        tableMapper,
        metaDb,
        this.v2ContainerService,
        this.v2ViewCompatService
      )
    );
  }
}
