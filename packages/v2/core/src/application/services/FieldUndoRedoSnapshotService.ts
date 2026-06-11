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

const normalizeLookupOptions = (
  options: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!options) {
    return undefined;
  }

  const { relationship: _relationship, ...rest } = options;
  return rest;
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
    const service = this;
    return safeTry<UndoRedoFieldSnapshot, DomainError>(async function* () {
      const field = yield* table.getField((candidate) => candidate.id().equals(fieldId));
      const tableDto = yield* service.tableMapper.toDTO(table);
      const fieldDto = tableDto.fields.find((candidate) => candidate.id === fieldId.toString());
      if (!fieldDto) {
        return err(domainError.notFound({ message: 'Field snapshot source not found' }));
      }

      const snapshotField = yield* toFieldSnapshotInput(field, fieldDto);
      const orderedFieldIdsByViewId = yield* service.captureOrderedFieldIdsByView(table);
      const views = tableDto.views.map((view) =>
        service.toViewSnapshot(
          view,
          fieldId.toString(),
          orderedFieldIdsByViewId.get(view.id) ??
            table.getFields().map((field) => field.id().toString())
        )
      );
      const records =
        options?.includeRecords === false
          ? undefined
          : yield* await service.captureRecords(context, table, field);

      return ok({
        field: snapshotField,
        hasError: field.hasError().toBoolean(),
        views,
        ...(records ? { records } : {}),
      });
    });
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
