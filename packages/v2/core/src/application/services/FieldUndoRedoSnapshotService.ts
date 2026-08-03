import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { hasCode, domainError, type DomainError } from '../../domain/shared/DomainError';
import { DbFieldName } from '../../domain/table/fields/DbFieldName';
import type { Field } from '../../domain/table/fields/Field';
import type { FieldId } from '../../domain/table/fields/FieldId';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type {
  ITableFieldPersistenceDTO,
  ITableMapper,
  ITableViewPersistenceDTO,
} from '../../ports/mappers/TableMapper';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import type { ITableRecordQueryRepository } from '../../ports/TableRecordQueryRepository';
import type { UndoRedoFieldSnapshot } from '../../ports/UndoRedoStore';
import { v2CoreTokens } from '../../ports/tokens';
import { tableFieldInputSchema } from '../../schemas/field';
import { TraceSpan } from '../../ports/TraceSpan';

type SnapshotRecordValues = NonNullable<UndoRedoFieldSnapshot['records']>;
type SnapshotRecordValue = SnapshotRecordValues[number];
type MutableSnapshotRecordValues = SnapshotRecordValue[];

type SnapshotSource = {
  readonly field: Field;
  readonly fieldId: string;
  readonly snapshotField: UndoRedoFieldSnapshot['field'];
  readonly views: UndoRedoFieldSnapshot['views'];
};

const stripUndefinedDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedDeep);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (nested === undefined) {
      continue;
    }
    result[key] = stripUndefinedDeep(nested);
  }
  return result;
};

// The persisted/realtime lookupOptions is enriched with derived data (relationship, and the
// parent link field's physical metadata: fkHostTableName/selfKeyName/foreignKeyName, baseId,
// filterByViewId, visibleFieldIds, isOneWay). The undo/redo snapshot must reduce it back to the
// canonical create-field input accepted by `lookupOptionsSchema` (.strict()), so we keep only the
// input keys rather than stripping a denylist that can drift as enrichment grows.
const LOOKUP_INPUT_OPTION_KEYS = [
  'linkFieldId',
  'foreignTableId',
  'lookupFieldId',
  'filter',
  'sort',
  'limit',
] as const;

const normalizeLookupOptions = (
  options: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!options) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  for (const key of LOOKUP_INPUT_OPTION_KEYS) {
    if (options[key] !== undefined) {
      result[key] = options[key];
    }
  }
  return result;
};

const toFieldSnapshotInput = (
  field: Field,
  fieldDto: ITableFieldPersistenceDTO
): Result<UndoRedoFieldSnapshot['field'], DomainError> => {
  const fieldDbFieldNameResult = field.dbFieldName();
  const fieldDbFieldName = fieldDbFieldNameResult.isOk()
    ? fieldDbFieldNameResult.value.value()._unsafeUnwrap()
    : fieldDto.dbFieldName;
  const common = {
    id: fieldDto.id,
    name: fieldDto.name,
    ...(fieldDbFieldName ? { dbFieldName: fieldDbFieldName } : {}),
    ...(fieldDto.description !== undefined ? { description: fieldDto.description } : {}),
    ...(fieldDto.aiConfig !== undefined ? { aiConfig: fieldDto.aiConfig } : {}),
    ...(fieldDto.notNull !== undefined ? { notNull: fieldDto.notNull } : {}),
    ...(fieldDto.unique !== undefined ? { unique: fieldDto.unique } : {}),
  } satisfies Record<string, unknown>;

  const raw: Record<string, unknown> = (() => {
    if (fieldDto.type === 'rollup') {
      return {
        ...common,
        type: 'rollup',
        options: fieldDto.options,
        config: fieldDto.config,
        ...(fieldDto.cellValueType ? { cellValueType: fieldDto.cellValueType } : {}),
        ...(fieldDto.isMultipleCellValue !== undefined
          ? { isMultipleCellValue: fieldDto.isMultipleCellValue }
          : {}),
      };
    }

    if (fieldDto.type === 'conditionalRollup') {
      return {
        ...common,
        type: 'conditionalRollup',
        options: fieldDto.options,
        config: fieldDto.config,
        ...(fieldDto.cellValueType ? { cellValueType: fieldDto.cellValueType } : {}),
        ...(fieldDto.isMultipleCellValue !== undefined
          ? { isMultipleCellValue: fieldDto.isMultipleCellValue }
          : {}),
      };
    }

    if (fieldDto.type === 'conditionalLookup') {
      return {
        ...common,
        type: 'conditionalLookup',
        options: fieldDto.options,
        ...(fieldDto.innerOptions ? { innerOptions: fieldDto.innerOptions } : {}),
        ...(fieldDto.isMultipleCellValue !== undefined
          ? { isMultipleCellValue: fieldDto.isMultipleCellValue }
          : {}),
      };
    }

    if (fieldDto.isLookup === true && fieldDto.lookupOptions) {
      return {
        ...common,
        type: 'lookup',
        options: normalizeLookupOptions(fieldDto.lookupOptions as Record<string, unknown>),
        ...(fieldDto.options ? { innerOptions: fieldDto.options } : {}),
        ...(fieldDto.isMultipleCellValue !== undefined
          ? { isMultipleCellValue: fieldDto.isMultipleCellValue }
          : {}),
      };
    }

    return {
      ...common,
      type: fieldDto.type,
      ...(fieldDto.options ? { options: fieldDto.options } : {}),
    };
  })();

  const parsed = tableFieldInputSchema.safeParse(stripUndefinedDeep(raw));
  if (!parsed.success) {
    return err(
      domainError.validation({
        message: 'Invalid field undo/redo snapshot input',
        details: z.formatError(parsed.error),
      })
    );
  }

  if (!parsed.data.id) {
    return err(domainError.validation({ message: 'Field undo/redo snapshot requires field id' }));
  }

  return ok(parsed.data as UndoRedoFieldSnapshot['field']);
};

@injectable()
export class FieldUndoRedoSnapshotService {
  constructor(
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: ITableMapper,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: ITableRecordQueryRepository
  ) {}

  @TraceSpan()
  async capture(
    context: IExecutionContext,
    table: Table,
    fieldId: FieldId,
    options?: {
      includeRecords?: boolean;
    }
  ): Promise<Result<UndoRedoFieldSnapshot, DomainError>> {
    const snapshotsResult = await this.captureMany(context, table, [fieldId], options);
    return snapshotsResult.map((snapshots) => snapshots[0]!);
  }

  @TraceSpan()
  async captureMany(
    context: IExecutionContext,
    table: Table,
    fieldIds: ReadonlyArray<FieldId>,
    options?: {
      includeRecords?: boolean;
    }
  ): Promise<Result<ReadonlyArray<UndoRedoFieldSnapshot>, DomainError>> {
    const service = this;
    return safeTry<ReadonlyArray<UndoRedoFieldSnapshot>, DomainError>(async function* () {
      const tableDto = yield* service.tableMapper.toDTO(table);
      const orderedFieldIdsByViewId = yield* service.captureOrderedFieldIdsByView(table);

      const sources: SnapshotSource[] = [];
      for (const fieldId of fieldIds) {
        sources.push(
          yield* service.buildSnapshotSource(table, tableDto, orderedFieldIdsByViewId, fieldId)
        );
      }

      const recordsByFieldId =
        options?.includeRecords === false
          ? new Map<string, SnapshotRecordValues | undefined>()
          : yield* await service.captureRecordsForFields(
              context,
              table,
              sources.map((source) => source.field)
            );

      return ok(
        sources.map((source) => service.toSnapshot(source, recordsByFieldId.get(source.fieldId)))
      );
    });
  }

  private buildSnapshotSource(
    table: Table,
    tableDto: {
      fields: ReadonlyArray<ITableFieldPersistenceDTO>;
      views: ReadonlyArray<ITableViewPersistenceDTO>;
    },
    orderedFieldIdsByViewId: ReadonlyMap<string, ReadonlyArray<string>>,
    fieldId: FieldId
  ): Result<SnapshotSource, DomainError> {
    const field = table.getField((candidate) => candidate.id().equals(fieldId));
    if (field.isErr()) {
      return err(field.error);
    }

    const fieldIdText = fieldId.toString();
    const fieldDto = tableDto.fields.find((candidate) => candidate.id === fieldIdText);
    if (!fieldDto) {
      return err(domainError.notFound({ message: 'Field snapshot source not found' }));
    }

    return toFieldSnapshotInput(field.value, fieldDto).map((snapshotField) => ({
      field: field.value,
      fieldId: fieldIdText,
      snapshotField,
      views: tableDto.views.map((view) =>
        this.toViewSnapshot(
          view,
          fieldIdText,
          orderedFieldIdsByViewId.get(view.id) ??
            table.getFields().map((field) => field.id().toString())
        )
      ),
    }));
  }

  private toSnapshot(
    source: SnapshotSource,
    records: SnapshotRecordValues | undefined
  ): UndoRedoFieldSnapshot {
    return {
      field: source.snapshotField,
      hasError: source.field.hasError().toBoolean(),
      views: source.views,
      ...(records ? { records } : {}),
    };
  }

  private toViewSnapshot(
    view: ITableViewPersistenceDTO,
    fieldId: string,
    orderedFieldIds: ReadonlyArray<string>
  ): UndoRedoFieldSnapshot['views'][number] {
    const columnMeta = view.columnMeta[fieldId] ?? null;
    return {
      viewId: view.id,
      columnMeta,
      query: view.query ?? {},
      orderedFieldIds,
    };
  }

  private captureOrderedFieldIdsByView(
    table: Table
  ): Result<ReadonlyMap<string, ReadonlyArray<string>>, DomainError> {
    const orderedFieldIdsByViewId = new Map<string, ReadonlyArray<string>>();
    const tableFieldIds = table.getFields().map((field, index) => ({
      fieldId: field.id().toString(),
      index,
    }));

    for (const view of table.views()) {
      const columnMetaResult = view.columnMeta();
      if (columnMetaResult.isErr()) {
        return err(columnMetaResult.error);
      }

      const columnMeta = columnMetaResult.value.toDto();
      const orderedFieldIds = [...tableFieldIds]
        .sort((left, right) => {
          const leftOrder = columnMeta[left.fieldId]?.order ?? Number.POSITIVE_INFINITY;
          const rightOrder = columnMeta[right.fieldId]?.order ?? Number.POSITIVE_INFINITY;
          if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
          }
          return left.index - right.index;
        })
        .map((entry) => entry.fieldId);

      orderedFieldIdsByViewId.set(view.id().toString(), orderedFieldIds);
    }

    return ok(orderedFieldIdsByViewId);
  }

  private ensureFieldDbFieldName(field: Field): void {
    if (field.dbFieldName().isOk()) {
      return;
    }

    const fallbackResult = DbFieldName.rehydrate(field.id().toString()).andThen((dbFieldName) =>
      field.setDbFieldName(dbFieldName)
    );
    if (fallbackResult.isErr()) {
      return;
    }
  }

  private async captureRecords(
    context: IExecutionContext,
    table: Table,
    field: Field
  ): Promise<Result<NonNullable<UndoRedoFieldSnapshot['records']> | undefined, DomainError>> {
    if (field.computed().toBoolean()) {
      return ok(undefined);
    }

    this.ensureFieldDbFieldName(field);
    const fieldId = field.id().toString();
    const queryResult = await this.tableRecordQueryRepository.find(context, table, undefined, {
      mode: 'stored',
      includeTotal: false,
      projectionFieldIds: [field.id()],
    });
    if (queryResult.isErr()) {
      if (this.isMissingColumnError(queryResult.error)) {
        return ok([]);
      }
      return err(queryResult.error);
    }

    return ok(queryResult.value.records.map((row) => this.toRecordSnapshot(row, fieldId)));
  }

  private async captureRecordsForFields(
    context: IExecutionContext,
    table: Table,
    fields: ReadonlyArray<Field>
  ): Promise<Result<ReadonlyMap<string, SnapshotRecordValues | undefined>, DomainError>> {
    const recordsByFieldId = new Map<string, SnapshotRecordValues | undefined>();
    const storedFields = fields.filter((field) => !field.computed().toBoolean());

    for (const field of fields) {
      if (field.computed().toBoolean()) {
        recordsByFieldId.set(field.id().toString(), undefined);
      }
    }

    if (!storedFields.length) {
      return ok(recordsByFieldId);
    }

    for (const field of storedFields) {
      this.ensureFieldDbFieldName(field);
    }

    const queryResult = await this.tableRecordQueryRepository.find(context, table, undefined, {
      mode: 'stored',
      includeTotal: false,
      projectionFieldIds: storedFields.map((field) => field.id()),
    });
    if (queryResult.isErr()) {
      if (!this.isMissingColumnError(queryResult.error)) {
        return err(queryResult.error);
      }

      if (storedFields.length === 1) {
        recordsByFieldId.set(storedFields[0]!.id().toString(), []);
        return ok(recordsByFieldId);
      }

      for (const field of storedFields) {
        const fieldRecordsResult = await this.captureRecords(context, table, field);
        if (fieldRecordsResult.isErr()) {
          return err(fieldRecordsResult.error);
        }
        recordsByFieldId.set(field.id().toString(), fieldRecordsResult.value);
      }
      return ok(recordsByFieldId);
    }

    const storedFieldIds = storedFields.map((field) => field.id().toString());
    const mutableRecordsByFieldId = new Map<string, MutableSnapshotRecordValues>();
    for (const fieldId of storedFieldIds) {
      const records: MutableSnapshotRecordValues = [];
      mutableRecordsByFieldId.set(fieldId, records);
      recordsByFieldId.set(fieldId, records);
    }

    for (const row of queryResult.value.records) {
      for (const fieldId of storedFieldIds) {
        mutableRecordsByFieldId.get(fieldId)!.push(this.toRecordSnapshot(row, fieldId));
      }
    }

    return ok(recordsByFieldId);
  }

  private toRecordSnapshot(
    row: TableRecordReadModel,
    fieldId: string
  ): NonNullable<UndoRedoFieldSnapshot['records']>[number] {
    return {
      recordId: row.id,
      value: Object.prototype.hasOwnProperty.call(row.fields, fieldId) ? row.fields[fieldId] : null,
    };
  }

  private isMissingColumnError(error: DomainError): boolean {
    if (hasCode(error, 'db.undefined_column')) {
      return true;
    }

    return error.details?.pgCode === '42703';
  }
}
