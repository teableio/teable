import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldUpdateSideEffectService } from '../application/services/FieldUpdateSideEffectService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { BaseId } from '../domain/base/BaseId';
import {
  domainError,
  hasCode,
  isNotFoundError,
  type DomainError,
} from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { RecordsBatchUpdated } from '../domain/table/events/RecordsBatchUpdated';
import { DbFieldName } from '../domain/table/fields/DbFieldName';
import type { Field } from '../domain/table/fields/Field';
import type { FieldId } from '../domain/table/fields/FieldId';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { TableUpdateFieldTypeSpec } from '../domain/table/specs/TableUpdateFieldTypeSpec';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import type { TableId } from '../domain/table/TableId';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { ITableRecordQueryRepository } from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import { ITableRepository } from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { buildUpdateFieldSpecs } from './TableFieldUpdateSpecs';
import { UpdateFieldCommand } from './UpdateFieldCommand';

export class UpdateFieldResult {
  private constructor(
    readonly table: Table,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(table: Table, events: ReadonlyArray<IDomainEvent>): UpdateFieldResult {
    return new UpdateFieldResult(table, [...events]);
  }
}

type IFieldValueSnapshot = {
  value: unknown;
  version: number;
};

@CommandHandler(UpdateFieldCommand)
@injectable()
export class UpdateFieldHandler implements ICommandHandler<UpdateFieldCommand, UpdateFieldResult> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.fieldUpdateSideEffectService)
    private readonly fieldUpdateSideEffectService: FieldUpdateSideEffectService,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: ITableRecordQueryRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus
  ) {}

  private hasTypeConversion(
    specs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>,
    fieldId: FieldId
  ): boolean {
    const targetFieldId = fieldId.toString();
    return specs.some(
      (spec) =>
        spec instanceof TableUpdateFieldTypeSpec &&
        spec.isTypeConversion() &&
        spec.newField().id().toString() === targetFieldId
    );
  }

  private ensureFieldDbFieldName(
    field: Field,
    fallbackDbFieldName?: string
  ): Result<void, DomainError> {
    if (field.dbFieldName().isOk()) {
      return ok(undefined);
    }

    const candidate = fallbackDbFieldName ?? field.id().toString();
    return DbFieldName.rehydrate(candidate).andThen((dbFieldName) =>
      field.setDbFieldName(dbFieldName)
    );
  }

  private ensureTypeConversionSpecDbFieldNames(
    specs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>,
    fallbackDbFieldName?: string
  ): Result<void, DomainError> {
    for (const spec of specs) {
      if (!(spec instanceof TableUpdateFieldTypeSpec)) {
        continue;
      }

      const oldFieldResult = this.ensureFieldDbFieldName(spec.oldField(), fallbackDbFieldName);
      if (oldFieldResult.isErr()) {
        return err(oldFieldResult.error);
      }

      const newFieldResult = this.ensureFieldDbFieldName(spec.newField(), fallbackDbFieldName);
      if (newFieldResult.isErr()) {
        return err(newFieldResult.error);
      }
    }

    return ok(undefined);
  }

  private async loadFieldValueSnapshotsByRecordId(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    fieldId: FieldId
  ): Promise<Result<Readonly<Record<string, IFieldValueSnapshot>>, DomainError>> {
    const snapshotsByRecordId: Record<string, IFieldValueSnapshot> = {};
    const fieldIdText = fieldId.toString();

    const runQuery = () =>
      this.tableRecordQueryRepository.find(context, table, undefined, {
        mode: 'stored',
        includeTotal: false,
        projectionFieldIds: [fieldId],
      });

    let queryResult = await runQuery();
    if (queryResult.isErr() && this.isMissingColumnError(queryResult.error)) {
      const fieldResult = table.getField((f) => f.id().equals(fieldId));
      if (fieldResult.isOk()) {
        const fallbackNameResult = DbFieldName.rehydrate(fieldIdText).andThen((dbFieldName) =>
          fieldResult.value.setDbFieldName(dbFieldName)
        );
        if (fallbackNameResult.isOk()) {
          queryResult = await runQuery();
          if (queryResult.isErr() && this.isMissingColumnError(queryResult.error)) {
            return ok({});
          }
        } else {
          return ok({});
        }
      } else {
        return ok({});
      }
    }
    if (queryResult.isErr()) {
      return err(queryResult.error);
    }

    for (const row of queryResult.value.records) {
      const readModel: TableRecordReadModel = row;
      snapshotsByRecordId[row.id] = {
        value: Object.prototype.hasOwnProperty.call(readModel.fields, fieldIdText)
          ? readModel.fields[fieldIdText]
          : null,
        version: readModel.version,
      };
    }

    return ok(snapshotsByRecordId);
  }

  private isMissingColumnError(error: DomainError): boolean {
    if (hasCode(error, 'db.undefined_column')) {
      return true;
    }

    return error.details?.pgCode === '42703';
  }

  private hasSameCellValue(left: unknown, right: unknown): boolean {
    try {
      return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
    } catch {
      return left === right;
    }
  }

  private async buildTypeConversionRecordUpdateEvents(
    table: Table,
    fieldId: FieldId,
    oldSnapshotsByRecordId: Readonly<Record<string, IFieldValueSnapshot>>,
    newSnapshotsByRecordId: Readonly<Record<string, IFieldValueSnapshot>>
  ): Promise<Result<ReadonlyArray<IDomainEvent>, DomainError>> {
    const fieldIdText = fieldId.toString();
    const eventChunks: IDomainEvent[] = [];
    const updates: Array<{
      recordId: string;
      oldVersion: number;
      newVersion: number;
      changes: Array<{ fieldId: string; oldValue: unknown; newValue: unknown }>;
    }> = [];
    const chunkSize = 500;
    const recordIds = new Set<string>([
      ...Object.keys(oldSnapshotsByRecordId),
      ...Object.keys(newSnapshotsByRecordId),
    ]);

    const flushChunk = () => {
      if (updates.length === 0) return;
      eventChunks.push(
        RecordsBatchUpdated.create({
          tableId: table.id(),
          baseId: table.baseId(),
          updates: [...updates],
          source: 'user',
        })
      );
      updates.length = 0;
    };

    for (const recordId of recordIds) {
      const oldSnapshot = oldSnapshotsByRecordId[recordId];
      const newSnapshot = newSnapshotsByRecordId[recordId];
      const oldValue = oldSnapshot?.value ?? null;
      const newValue = newSnapshot?.value ?? null;
      if (this.hasSameCellValue(oldValue, newValue)) {
        continue;
      }

      const oldVersion = oldSnapshot?.version ?? Math.max((newSnapshot?.version ?? 1) - 1, 0);

      updates.push({
        recordId,
        oldVersion,
        newVersion: oldVersion + 1,
        changes: [
          {
            fieldId: fieldIdText,
            oldValue,
            newValue,
          },
        ],
      });

      if (updates.length >= chunkSize) {
        flushChunk();
      }
    }

    flushChunk();
    return ok(eventChunks);
  }

  /**
   * Extract foreign table references from an existing field's config.
   * Used to ensure foreign tables are loaded even when update payload doesn't include config.
   */
  private extractForeignTableReferencesFromField(
    field: Field
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    const references: LinkForeignTableReference[] = [];
    const fieldType = field.type().toString();

    // For ConditionalRollupField and RollupField, check config for foreignTableId
    if (fieldType === 'conditionalRollup' || fieldType === 'rollup') {
      // These fields have a config() method that returns config with foreignTableId() method
      const fieldWithConfig = field as unknown as {
        config(): { foreignTableId(): TableId; baseId?: BaseId };
      };
      const config = fieldWithConfig.config();
      const foreignTableId = config.foreignTableId();
      if (foreignTableId) {
        references.push({
          foreignTableId,
          baseId: config.baseId,
        });
      }
    }

    // For LookupField and LinkField, access foreignTableId() directly on the field
    if (fieldType === 'lookup' || fieldType === 'link') {
      const fieldWithForeignTable = field as unknown as {
        foreignTableId(): TableId;
        baseId?(): BaseId;
      };
      const foreignTableId = fieldWithForeignTable.foreignTableId();
      if (foreignTableId) {
        references.push({
          foreignTableId,
          baseId: fieldWithForeignTable.baseId?.(),
        });
      }
    }

    return ok(references);
  }

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: UpdateFieldCommand
  ): Promise<Result<UpdateFieldResult, DomainError>> {
    const handler = this;
    return safeTry<UpdateFieldResult, DomainError>(async function* () {
      // 1. Load the table first to access existing field config
      const whereSpec = yield* TableAggregate.specs().byId(command.tableId).build();
      const tableResult = await handler.tableRepository.findOne(context, whereSpec);
      if (tableResult.isErr()) {
        if (isNotFoundError(tableResult.error)) {
          return err(
            domainError.notFound({
              code: 'table.not_found',
              message: 'Table not found',
            })
          );
        }
        return err(tableResult.error);
      }
      const table = tableResult.value;

      // 2. Get the existing field to extract foreign table references
      const fieldResult = table.getField((f) => f.id().equals(command.fieldId));
      if (fieldResult.isErr()) {
        return err(fieldResult.error);
      }
      const existingField = fieldResult.value;
      const shouldCaptureOldFieldSnapshots =
        typeof command.fieldUpdate.type === 'string' &&
        command.fieldUpdate.type !== existingField.type().toString();
      if (shouldCaptureOldFieldSnapshots) {
        yield* handler.ensureFieldDbFieldName(existingField);
      }
      const oldSnapshotsByRecordId = shouldCaptureOldFieldSnapshots
        ? yield* await handler.loadFieldValueSnapshotsByRecordId(context, table, command.fieldId)
        : {};

      // 3. Extract foreign table references from both command and existing field
      const commandReferences = yield* command.foreignTableReferences();
      const existingReferences =
        yield* handler.extractForeignTableReferencesFromField(existingField);

      // Merge references, avoiding duplicates
      const allReferences = [...commandReferences];
      for (const ref of existingReferences) {
        if (!allReferences.some((r) => r.foreignTableId.equals(ref.foreignTableId))) {
          allReferences.push(ref);
        }
      }

      // 4. Load foreign tables
      const foreignTables = yield* await handler.foreignTableLoaderService.load(context, {
        references: allReferences,
      });

      // 5. Track field and specs for side effects
      const previousField: Field | undefined = existingField;
      const updateSpecsResult = buildUpdateFieldSpecs(existingField, command.fieldUpdate, {
        hostTable: table,
        foreignTables,
      });
      if (updateSpecsResult.isErr()) return err(updateSpecsResult.error);
      const updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>> =
        updateSpecsResult.value;
      yield* handler.ensureTypeConversionSpecDbFieldNames(updateSpecs);

      // 6. Execute update flow with the already-loaded table
      const updateResult = yield* await handler.tableUpdateFlow.execute(
        context,
        { table }, // Pass the already-loaded table to avoid reloading
        (tableToUpdate) =>
          tableToUpdate.update((mutator) =>
            mutator.updateField(command.fieldId, updateSpecs, { foreignTables })
          ),
        {
          hooks: {
            prepare: async (transactionContext, updatedTable) =>
              safeTry<ReadonlyArray<IDomainEvent>, DomainError>(async function* () {
                const effectiveUpdatedField = yield* updatedTable.getField((f) =>
                  f.id().equals(command.fieldId)
                );

                const prepareEvents = yield* await handler.fieldUpdateSideEffectService.prepare(
                  transactionContext,
                  {
                    table: updatedTable,
                    updatedField: effectiveUpdatedField,
                    previousField,
                    updateSpecs,
                    foreignTables,
                  }
                );

                return ok([...prepareEvents]);
              }),
            afterPersist: async (transactionContext, updatedTable) =>
              safeTry<{ events: ReadonlyArray<IDomainEvent>; table: Table }, DomainError>(
                async function* () {
                  const effectiveUpdatedField = yield* updatedTable.getField((f) =>
                    f.id().equals(command.fieldId)
                  );

                  const allEvents: IDomainEvent[] = [];
                  const sideEffectResult =
                    yield* await handler.fieldUpdateSideEffectService.execute(transactionContext, {
                      table: updatedTable,
                      updatedField: effectiveUpdatedField,
                      previousField,
                      updateSpecs,
                      foreignTables,
                    });
                  allEvents.push(...sideEffectResult.events);

                  return ok({ events: allEvents, table: sideEffectResult.updatedTable });
                }
              ),
          },
        }
      );

      const hasTypeConversion = handler.hasTypeConversion(updateSpecs, command.fieldId);
      if (!hasTypeConversion) {
        return ok(UpdateFieldResult.create(updateResult.table, updateResult.events));
      }

      const typeConversionSpec = updateSpecs.find(
        (spec): spec is TableUpdateFieldTypeSpec =>
          spec instanceof TableUpdateFieldTypeSpec &&
          spec.newField().id().equals(command.fieldId) &&
          spec.isTypeConversion()
      );
      const oldDbFieldNameResult = typeConversionSpec
        ?.oldField()
        .dbFieldName()
        .andThen((name) => name.value());
      const effectiveDbFieldNameFallback =
        oldDbFieldNameResult && oldDbFieldNameResult.isOk()
          ? oldDbFieldNameResult.value
          : undefined;
      const updatedField = yield* updateResult.table.getField((f) =>
        f.id().equals(command.fieldId)
      );
      yield* handler.ensureFieldDbFieldName(updatedField, effectiveDbFieldNameFallback);

      const newSnapshotsByRecordId = yield* await handler.loadFieldValueSnapshotsByRecordId(
        context,
        updateResult.table,
        command.fieldId
      );

      const conversionEvents = yield* await handler.buildTypeConversionRecordUpdateEvents(
        updateResult.table,
        command.fieldId,
        oldSnapshotsByRecordId,
        newSnapshotsByRecordId
      );

      if (conversionEvents.length > 0) {
        yield* await handler.eventBus.publishMany(context, conversionEvents);
      }

      return ok(
        UpdateFieldResult.create(updateResult.table, [...updateResult.events, ...conversionEvents])
      );
    });
  }
}
