import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { RecordWritePluginRunner } from '../application/services/RecordWritePluginRunner';
import { TableCreationService } from '../application/services/TableCreationService';
import { TableOperationPluginRunner } from '../application/services/TableOperationPluginRunner';
import type { BaseId } from '../domain/base/BaseId';
import { domainError, isDomainError, type DomainError } from '../domain/shared/DomainError';
import { TableCreated } from '../domain/table/events/TableCreated';
import { FieldId } from '../domain/table/fields/FieldId';
import { validateForeignTablesForFields } from '../domain/table/fields/ForeignTableRelatedField';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { calculateBatchSize } from '../domain/table/methods/records/calculateBatchSize';
import { RecordId } from '../domain/table/records/RecordId';
import { TableRecord } from '../domain/table/records/TableRecord';
import { TableRecordCellValue } from '../domain/table/records/TableRecordFields';
import { resolveFormulaFields } from '../domain/table/resolveFormulaFields';
import type { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { IBaseDataBulkCopier } from '../ports/BaseDataBulkCopier';
import type {
  BaseDataBulkCopyPlan,
  BaseDataBulkCopyResult,
  BulkCopyJunctionInput,
  BulkCopyTableInput,
} from '../ports/BaseDataBulkCopier';
import { IComputedFieldBackfillService } from '../ports/ComputedFieldBackfillService';
import { NoopBaseDataBulkCopier } from '../ports/defaults/NoopBaseDataBulkCopier';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { NormalizedDotTeaStructure } from '../ports/DotTeaParser';
import * as EventBusPort from '../ports/EventBus';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { DefaultTableMapper } from '../ports/mappers/defaults/DefaultTableMapper';
import { ITableMapper } from '../ports/mappers/TableMapper';
import type { ITablePersistenceDTO } from '../ports/mappers/TableMapper';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import { TableOperationKind } from '../ports/TableOperationPlugin';
import type {
  InsertManyStreamBatch,
  RecordRestoreSystemValues,
  UpdateManyStreamBatchInput,
} from '../ports/TableRecordRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import type { ITableFieldInput } from '../schemas/field';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import {
  DuplicateBaseCommand,
  type DuplicateBaseDoneEvent,
  type DuplicateBaseEvent,
  type DuplicateBaseProgressEvent,
  type DuplicateBaseRecordInput,
  type DuplicateBaseResult,
} from './DuplicateBaseCommand';
import { buildTableFromInput } from './TableInputParser';

const sequence = <T>(
  values: ReadonlyArray<Result<T, DomainError>>
): Result<ReadonlyArray<T>, DomainError> =>
  values.reduce<Result<ReadonlyArray<T>, DomainError>>(
    (acc, next) => acc.andThen((arr) => next.map((value) => [...arr, value])),
    ok([])
  );

const uniqueForeignTableReferences = (
  refs: ReadonlyArray<LinkForeignTableReference>
): ReadonlyArray<LinkForeignTableReference> => {
  const unique: LinkForeignTableReference[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const baseKey = ref.baseId ? ref.baseId.toString() : 'local';
    const key = `${baseKey}:${ref.foreignTableId.toString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique;
};

const isInternalReference = (
  ref: LinkForeignTableReference,
  baseId: BaseId,
  internalTableIds: ReadonlySet<string>
): boolean => {
  if (ref.baseId && !ref.baseId.equals(baseId)) return false;
  return internalTableIds.has(ref.foreignTableId.toString());
};

const replaceMappedIds = <T>(value: T, replacements: ReadonlyMap<string, string>): T => {
  if (value == null || replacements.size === 0) return value;
  let serialized = JSON.stringify(value);
  if (serialized == null) return value;
  for (const [sourceId, targetId] of replacements) {
    serialized = serialized.split(sourceId).join(targetId);
  }
  return JSON.parse(serialized) as T;
};

const resetDuplicatedViewIdentity = (
  view: ITablePersistenceDTO['views'][number]
): ITablePersistenceDTO['views'][number] => {
  const {
    version: _version,
    enableShare: _enableShare,
    shareId: _shareId,
    shareMeta: _shareMeta,
    createdBy: _createdBy,
    createdTime: _createdTime,
    lastModifiedBy: _lastModifiedBy,
    lastModifiedTime: _lastModifiedTime,
    ...portableState
  } = view;
  return { ...portableState, enableShare: false };
};

@CommandHandler(DuplicateBaseCommand)
@injectable()
export class DuplicateBaseHandler
  implements ICommandHandler<DuplicateBaseCommand, DuplicateBaseResult>
{
  constructor(
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.tableCreationService)
    private readonly tableCreationService: TableCreationService,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork,
    @inject(v2CoreTokens.computedFieldBackfillService)
    private readonly computedFieldBackfillService: IComputedFieldBackfillService,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: ITableMapper = new DefaultTableMapper(),
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner = new RecordWritePluginRunner(
      [],
      new NoopLogger(),
      new DefaultTableMapper()
    ),
    @inject(v2CoreTokens.tableOperationPluginRunner)
    private readonly tableOperationPluginRunner: TableOperationPluginRunner = new TableOperationPluginRunner(
      [],
      new NoopLogger()
    ),
    @inject(v2CoreTokens.baseDataBulkCopier)
    private readonly baseDataBulkCopier: IBaseDataBulkCopier = new NoopBaseDataBulkCopier()
  ) {}

  async handle(
    context: IExecutionContext,
    command: DuplicateBaseCommand
  ): Promise<Result<DuplicateBaseResult, DomainError>> {
    return ok(this.createStream(context, command));
  }

  private async *createStream(
    context: IExecutionContext,
    command: DuplicateBaseCommand
  ): AsyncGenerator<DuplicateBaseEvent> {
    try {
      yield {
        id: 'progress',
        phase: 'table_structure_committing',
        totalTables: command.source.structure.tables.length,
      };
      const structureResult = await this.createTables(context, command);
      if (structureResult.isErr()) {
        yield this.errorEvent(structureResult.error);
        return;
      }

      const { result, tablesBySourceId } = structureResult.value;
      const totalTables = command.source.structure.tables.length;
      for (const [tableIndex, table] of command.source.structure.tables.entries()) {
        const targetTable = table.id ? tablesBySourceId.get(table.id) : undefined;
        if (!targetTable) continue;
        yield {
          id: 'progress',
          phase: 'table_structure_done',
          tableId: targetTable.id().toString(),
          tableName: targetTable.name().toString(),
          tableIndex: tableIndex + 1,
          totalTables,
        };
      }
      let recordsLength = 0;
      let recordCopyMode: DuplicateBaseDoneEvent['recordCopyMode'] = 'none';
      if (command.withRecords) {
        const bulkCopyPlan = this.buildBulkCopyPlan(command, tablesBySourceId, result);
        const bulkCopySupported = bulkCopyPlan
          ? await this.baseDataBulkCopier.isSupported(context, bulkCopyPlan)
          : undefined;
        const bulkCopyReady =
          bulkCopyPlan !== undefined &&
          bulkCopySupported?.isOk() === true &&
          bulkCopySupported.value;

        if (bulkCopyPlan && bulkCopyReady) {
          // Same-database physical copy: rows, link storage columns and junction
          // tables are cloned verbatim, so no link restore or computed backfill
          // runs here; the host recomputes persisted computed columns after the
          // command completes.
          recordCopyMode = 'bulk';
          const bulkCopyResult = yield* this.bulkCopyRecordsStream(context, bulkCopyPlan);
          if (bulkCopyResult.isErr()) {
            yield this.errorEvent(bulkCopyResult.error);
            return;
          }
          recordsLength = bulkCopyResult.value.recordsLength;
        } else {
          recordCopyMode = 'stream';
          for (const table of command.source.structure.tables) {
            const targetTable = tablesBySourceId.get(table.id ?? '');
            if (!targetTable || !table.id) continue;

            for await (const event of this.createRecordsStream(context, command, {
              sourceTableId: table.id,
              sourceTableName: table.name ?? targetTable.name().toString(),
              targetTable,
              tableIdMap: result.tableIdMap,
              fieldIdMap: result.fieldIdMap,
              viewIdMap: result.viewIdMap,
            })) {
              yield event;
              if (event.id === 'error') return;
              if (event.id === 'progress' && event.phase === 'table_data_done') {
                recordsLength += event.processedRows ?? 0;
              }
            }
          }

          for (const table of command.source.structure.tables) {
            const targetTable = tablesBySourceId.get(table.id ?? '');
            if (!targetTable || !table.id) continue;

            for await (const event of this.restoreLinkFieldsStream(context, command, {
              sourceTableId: table.id,
              targetTable,
              fieldIdMap: result.fieldIdMap,
            })) {
              yield event;
              if (event.id === 'error') return;
            }
          }

          const backfillResult = await this.backfillComputedFields(
            context,
            Array.from(tablesBySourceId.values())
          );
          if (backfillResult.isErr()) {
            yield this.errorEvent(backfillResult.error);
            return;
          }
        }
      }

      yield {
        id: 'done',
        baseId: command.baseId.toString(),
        tableIdMap: result.tableIdMap,
        fieldIdMap: result.fieldIdMap,
        viewIdMap: result.viewIdMap,
        recordsLength,
        recordCopyMode,
      } satisfies DuplicateBaseDoneEvent;
    } catch (error) {
      yield this.errorEvent(
        isDomainError(error)
          ? error
          : domainError.fromUnknown(error, { code: 'duplicate_base.unexpected' })
      );
    }
  }

  private async createTables(context: IExecutionContext, command: DuplicateBaseCommand) {
    const handler = this;
    return safeTry<
      {
        result: {
          tableIdMap: Record<string, string>;
          fieldIdMap: Record<string, string>;
          viewIdMap: Record<string, string>;
        };
        tablesBySourceId: ReadonlyMap<string, Table>;
      },
      DomainError
    >(async function* () {
      const normalized = command.source.structure;
      const { remapped, tableIdMap, fieldIdMap, viewIdMap } = yield* await handler.remapStructure(
        command.baseId,
        normalized
      );

      const replacements = new Map<string, string>([
        ...(normalized.id ? ([[normalized.id, command.baseId.toString()]] as const) : []),
        ...Object.entries(tableIdMap),
        ...Object.entries(fieldIdMap),
        ...Object.entries(viewIdMap),
      ]);
      const buildResults = yield* sequence(
        remapped.tables.map((table, tableIndex) => {
          const tableId = table.id!;
          const tableName = table.name ?? `Table ${tableIndex + 1}`;
          const sourceTableId = normalized.tables[tableIndex]?.id;
          const snapshot = sourceTableId
            ? command.source.tableSnapshots?.get(sourceTableId)
            : undefined;
          if (snapshot) {
            return handler.buildTableFromSnapshot(snapshot, {
              baseId: command.baseId,
              tableId,
              tableName,
              replacements,
            });
          }
          return buildTableFromInput(
            {
              baseId: command.baseId.toString(),
              tableId,
              name: tableName,
              fields: table.fields.map((field) => ({
                id: field.id,
                dbFieldName: field.dbFieldName,
                type: field.type as ITableFieldInput['type'],
                name: field.name,
                description: field.description,
                aiConfig: field.aiConfig,
                isPrimary: field.isPrimary,
                notNull: field.notNull,
                unique: field.unique,
                options: field.options,
                config: field.config,
                cellValueType: field.cellValueType,
                isMultipleCellValue: field.isMultipleCellValue,
              })) as ITableFieldInput[],
              views: table.views?.map((view) => ({
                id: view.id,
                type: view.type,
                name: view.name,
              })),
            },
            { executionContext: context, aiConfigMode: 'trustedRehydrate' }
          );
        })
      );

      const builtTables = buildResults.map((r) => r.table);
      const referencesByTable = buildResults.map((r) => r.foreignTableReferences);
      const tablePluginExecution = yield* await handler.tableOperationPluginRunner.prepare({
        kind: TableOperationKind.createMany,
        executionContext: context,
        payload: {
          baseId: command.baseId,
          tables: builtTables.map((table) => ({
            baseId: command.baseId,
            tableName: table.name(),
            table,
            fieldCount: table.getFields().length,
            viewCount: table.views().length,
            recordCount: 0,
            viewNames: table.views().map((view) => view.name().toString()),
          })),
        },
        isTransactionBound: false,
      });
      yield* await tablePluginExecution.guard();
      const allReferences = uniqueForeignTableReferences(referencesByTable.flat());
      const internalTableIds = new Set(builtTables.map((table) => table.id().toString()));
      const externalReferences = allReferences.filter(
        (ref) => !isInternalReference(ref, command.baseId, internalTableIds)
      );
      const externalTables = yield* await handler.foreignTableLoaderService.load(context, {
        baseId: command.baseId,
        references: externalReferences,
      });

      const foreignTables = [...externalTables, ...builtTables];
      for (const table of builtTables) {
        yield* validateForeignTablesForFields(table.getFields(), {
          hostTable: table,
          foreignTables,
        });
      }

      const transactionResult = yield* await handler.unitOfWork.withTransaction(
        context,
        async (transactionContext) =>
          handler.tableCreationService.execute(transactionContext, {
            baseId: command.baseId,
            tables: builtTables,
            externalTables,
            referencesByTable,
            schemaOptions: {
              optimizeForEmptyTables: true,
              skipUndoCaptureSetup: true,
            },
            sideEffectOptions: {
              skipFieldCreationSideEffects: true,
            },
          })
      );

      const events = [
        ...builtTables.flatMap((table) => table.pullDomainEvents()),
        ...transactionResult.sideEffectEvents,
      ];
      yield* await handler.eventBus.publishMany(context, events);

      return ok({
        result: { tableIdMap, fieldIdMap, viewIdMap },
        tablesBySourceId: new Map(
          normalized.tables.flatMap((table) => {
            if (!table.id) return [];
            const targetTableId = tableIdMap[table.id];
            const persisted = transactionResult.persistedTables.find(
              (target) => target.id().toString() === targetTableId
            );
            return persisted ? ([[table.id, persisted]] as const) : [];
          })
        ),
      });
    });
  }

  private buildTableFromSnapshot(
    snapshot: ITablePersistenceDTO,
    params: {
      baseId: BaseId;
      tableId: string;
      tableName: string;
      replacements: ReadonlyMap<string, string>;
    }
  ) {
    const remapped = replaceMappedIds(snapshot, params.replacements);
    const dto: ITablePersistenceDTO = {
      ...remapped,
      id: params.tableId,
      baseId: params.baseId.toString(),
      name: params.tableName,
      dbTableName: `${params.baseId.toString()}.${params.tableId}`,
      fields: remapped.fields,
      views: remapped.views.map(resetDuplicatedViewIdentity),
    };

    return this.tableMapper.toDomain(dto).andThen((table) =>
      resolveFormulaFields(table).andThen(() =>
        table.foreignTableReferences().map((foreignTableReferences) => {
          table.addDomainEvent(
            TableCreated.create({
              tableId: table.id(),
              baseId: table.baseId(),
              tableName: table.name(),
              fieldIds: table.fieldIds(),
              viewIds: table.viewIds(),
            })
          );
          return { table, fieldSpecs: [], foreignTableReferences };
        })
      )
    );
  }

  /**
   * Assembles the physical copy plan for the same-database fast path. Returns
   * undefined — falling back to row streaming — whenever the source carries no
   * physical layout (portable imports) or a freshly created target table does
   * not expose its physical name yet.
   */
  private buildBulkCopyPlan(
    command: DuplicateBaseCommand,
    tablesBySourceId: ReadonlyMap<string, Table>,
    result: {
      tableIdMap: Record<string, string>;
      fieldIdMap: Record<string, string>;
      viewIdMap: Record<string, string>;
    }
  ): BaseDataBulkCopyPlan | undefined {
    const source = command.source;
    const sourceDbTableNameByTableId = source.sourceDbTableNameByTableId;
    if (!sourceDbTableNameByTableId) {
      return undefined;
    }

    const dtoByTableId = new Map<string, ITablePersistenceDTO>();
    const targetDto = (table: Table): ITablePersistenceDTO | undefined => {
      const tableId = table.id().toString();
      const cached = dtoByTableId.get(tableId);
      if (cached) return cached;
      const dtoResult = this.tableMapper.toDTO(table);
      if (dtoResult.isErr()) return undefined;
      dtoByTableId.set(tableId, dtoResult.value);
      return dtoResult.value;
    };

    const tables: BulkCopyTableInput[] = [];
    for (const sourceTable of source.structure.tables) {
      const sourceTableId = sourceTable.id;
      if (!sourceTableId) continue;
      const targetTable = tablesBySourceId.get(sourceTableId);
      if (!targetTable) continue;
      const sourceDbTableName = sourceDbTableNameByTableId[sourceTableId];
      const targetDbTableNameResult = targetTable.dbTableName().andThen((name) => name.value());
      const dto = targetDto(targetTable);
      if (!sourceDbTableName || targetDbTableNameResult.isErr() || !dto) {
        return undefined;
      }
      const excludedTargetColumns = dto.fields
        .filter((field) => field.isComputed === true || field.type === 'button')
        .map((field) => field.dbFieldName)
        .filter((name): name is string => typeof name === 'string' && name.length > 0);
      tables.push({
        sourceTableId,
        targetTableId: targetTable.id().toString(),
        targetTableName: targetTable.name().toString(),
        sourceDbTableName,
        targetDbTableName: targetDbTableNameResult.value,
        excludedTargetColumns,
        linkValueColumns: source.linkValueColumnsByTableId?.[sourceTableId] ?? [],
      });
    }
    if (tables.length === 0) {
      return undefined;
    }

    // Junction pairs join the source physical link storage (pre-filtered by the
    // host for cross-base allowance and disconnected links) with the freshly
    // created target link fields; a source link whose target is no longer a
    // link has no junction to copy.
    const junctions: BulkCopyJunctionInput[] = [];
    const seenJunctions: Record<string, true> = {};
    for (const sourceLinkField of source.sourceLinkFields ?? []) {
      if (!sourceLinkField.fkHostTableName.includes('junction_')) continue;
      const targetFieldId = result.fieldIdMap[sourceLinkField.fieldId];
      const targetTable = tablesBySourceId.get(sourceLinkField.tableId);
      if (!targetFieldId || !targetTable) continue;
      const dto = targetDto(targetTable);
      if (!dto) return undefined;
      const targetLinkField = dto.fields.find(
        (field) => field.id === targetFieldId && field.type === 'link'
      );
      if (!targetLinkField || targetLinkField.type !== 'link') continue;
      const { fkHostTableName, selfKeyName, foreignKeyName } = targetLinkField.options;
      if (!fkHostTableName || !selfKeyName || !foreignKeyName) continue;
      const junctionKey = `${sourceLinkField.fkHostTableName}:${fkHostTableName}`;
      if (seenJunctions[junctionKey]) continue;
      seenJunctions[junctionKey] = true;
      junctions.push({
        sourceJunctionDbTableName: sourceLinkField.fkHostTableName,
        targetJunctionDbTableName: fkHostTableName,
        sourceSelfKeyName: sourceLinkField.selfKeyName,
        sourceForeignKeyName: sourceLinkField.foreignKeyName,
        targetSelfKeyName: selfKeyName,
        targetForeignKeyName: foreignKeyName,
      });
    }

    return {
      tables,
      junctions,
      viewIdMap: result.viewIdMap,
      fieldIdMap: result.fieldIdMap,
      batchSize: command.batchSize,
    };
  }

  /**
   * Bridges the copier's progress callback into the command event stream while
   * the physical copy runs.
   */
  private async *bulkCopyRecordsStream(
    context: IExecutionContext,
    plan: BaseDataBulkCopyPlan
  ): AsyncGenerator<DuplicateBaseProgressEvent, Result<BaseDataBulkCopyResult, DomainError>> {
    const queue: DuplicateBaseProgressEvent[] = [];
    let wake: (() => void) | undefined;
    const copyPromise: Promise<Result<BaseDataBulkCopyResult, DomainError>> =
      this.baseDataBulkCopier
        .copyBaseData(context, plan, (progress) => {
          queue.push({ id: 'progress', ...progress });
          wake?.();
        })
        .catch((error: unknown) =>
          err(domainError.fromUnknown(error, { code: 'duplicate_base.bulk_copy_failed' }))
        );
    let settled = false;
    void copyPromise.then(() => {
      settled = true;
      wake?.();
    });

    while (queue.length > 0 || !settled) {
      const event = queue.shift();
      if (event) {
        yield event;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = undefined;
    }
    return copyPromise;
  }

  private async backfillComputedFields(
    context: IExecutionContext,
    targetTables: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    return safeTry<void, DomainError>(
      async function* (this: DuplicateBaseHandler) {
        for (const table of targetTables) {
          yield* await this.computedFieldBackfillService.executeSyncMany(context, {
            table,
            fields: table.getFields(),
            skipDistinctFilter: true,
            includeOneManyTwoWay: true,
          });
        }

        return ok(undefined);
      }.bind(this)
    );
  }

  private async remapStructure(baseId: BaseId, normalized: NormalizedDotTeaStructure) {
    return safeTry<
      {
        remapped: NormalizedDotTeaStructure;
        tableIdMap: Record<string, string>;
        fieldIdMap: Record<string, string>;
        viewIdMap: Record<string, string>;
      },
      DomainError
    >(async function* () {
      const tableIdMap: Record<string, string> = {};
      const fieldIdMap: Record<string, string> = {};
      const viewIdMap: Record<string, string> = {};
      const tablePlans: Array<{ tableId: string; fieldIds: string[]; viewIds: string[] }> = [];

      for (const table of normalized.tables) {
        const targetTableId = (yield* TableId.generate()).toString();
        if (table.id) tableIdMap[table.id] = targetTableId;
        const fieldIds: string[] = [];
        for (const field of table.fields) {
          const targetFieldId = (yield* FieldId.generate()).toString();
          fieldIds.push(targetFieldId);
          if (field.id) fieldIdMap[field.id] = targetFieldId;
        }
        const viewIds: string[] = [];
        for (const view of table.views ?? []) {
          const targetViewId = (yield* ViewId.generate()).toString();
          viewIds.push(targetViewId);
          if (view.id) viewIdMap[view.id] = targetViewId;
        }
        tablePlans.push({ tableId: targetTableId, fieldIds, viewIds });
      }

      const replacements = new Map<string, string>([
        ...(normalized.id ? ([[normalized.id, baseId.toString()]] as const) : []),
        ...Object.entries(tableIdMap),
        ...Object.entries(fieldIdMap),
        ...Object.entries(viewIdMap),
      ]);
      const remapped: NormalizedDotTeaStructure = {
        ...normalized,
        tables: normalized.tables.map((table, tableIndex) => {
          const plan = tablePlans[tableIndex]!;
          return {
            ...table,
            id: plan.tableId,
            fields: table.fields.map((field, fieldIndex) => ({
              ...field,
              id: plan.fieldIds[fieldIndex]!,
              options: replaceMappedIds(field.options, replacements),
              config: replaceMappedIds(field.config, replacements),
              aiConfig: replaceMappedIds(field.aiConfig, replacements),
            })),
            views: table.views?.map((view, viewIndex) => ({
              ...view,
              id: plan.viewIds[viewIndex]!,
            })),
          };
        }),
      };

      return ok({ remapped, tableIdMap, fieldIdMap, viewIdMap });
    });
  }

  private async *createRecordsStream(
    context: IExecutionContext,
    command: DuplicateBaseCommand,
    params: {
      sourceTableId: string;
      sourceTableName: string;
      targetTable: Table;
      tableIdMap: Record<string, string>;
      fieldIdMap: Record<string, string>;
      viewIdMap: Record<string, string>;
    }
  ): AsyncGenerator<DuplicateBaseEvent> {
    let totalInserted = 0;
    let batchIndex = 0;
    const batchSize = this.resolveTableRecordBatchSize(params.targetTable, command.batchSize);

    yield {
      id: 'progress',
      phase: 'table_data_start',
      tableId: params.targetTable.id().toString(),
      tableName: params.sourceTableName,
      processedRows: 0,
    };

    for await (const batch of this.buildInsertBatches(
      params.targetTable,
      command.source.records(params.sourceTableId, { phase: 'insert' }),
      params.fieldIdMap,
      params.viewIdMap,
      batchSize,
      this.getSourceLinkFieldIds(command, params.sourceTableId)
    )) {
      const currentBatchIndex = batchIndex;
      const pluginExecutionResult = await this.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.duplicateStream,
        executionContext: context,
        table: params.targetTable,
        payload: {
          sourceRecordIds: batch.records.map((record) => record.id()),
          recordsFieldValues: batch.records.map(tableRecordToRecordWriteFieldValues),
          batchSize,
          recordCount: batch.records.length,
        },
        isTransactionBound: false,
      });
      if (pluginExecutionResult.isErr()) {
        yield this.errorEvent(pluginExecutionResult.error);
        return;
      }
      const pluginExecution = pluginExecutionResult.value;
      const guardResult = await pluginExecution.guard();
      if (guardResult.isErr()) {
        yield this.errorEvent(guardResult.error);
        return;
      }

      const recordRepository = this.tableRecordRepository;
      const result = await this.unitOfWork.withTransaction(context, async (transactionContext) =>
        safeTry<{ totalInserted: number }, DomainError>(async function* () {
          yield* await pluginExecution.beforePersist(transactionContext);
          const inserted = yield* await recordRepository.insertManyStream(
            transactionContext,
            params.targetTable,
            [batch],
            {
              skipComputedUpdates: true,
              skipChangedFields: true,
            }
          );
          return ok(inserted);
        })
      );
      if (result.isErr()) {
        yield this.errorEvent(result.error);
        return;
      }
      await pluginExecution.afterCommit();

      totalInserted += result.value.totalInserted;
      yield {
        id: 'progress',
        phase: 'table_data_progress',
        tableId: params.targetTable.id().toString(),
        tableName: params.sourceTableName,
        processedRows: totalInserted,
        batchProcessedRows: result.value.totalInserted,
        currentBatch: currentBatchIndex + 1,
      };
      batchIndex += 1;
    }

    yield {
      id: 'progress',
      phase: 'table_data_done',
      tableId: params.targetTable.id().toString(),
      tableName: params.sourceTableName,
      processedRows: totalInserted,
    };
  }

  private async *restoreLinkFieldsStream(
    context: IExecutionContext,
    command: DuplicateBaseCommand,
    params: {
      sourceTableId: string;
      targetTable: Table;
      fieldIdMap: Record<string, string>;
    }
  ): AsyncGenerator<DuplicateBaseEvent> {
    const sourceLinkFieldIds = this.getSourceLinkRestoreFieldIds(command, params.sourceTableId);
    if (!sourceLinkFieldIds.size) {
      return;
    }

    const result = await this.unitOfWork.withTransaction(context, async (transactionContext) =>
      this.tableRecordRepository.updateManyStream(
        transactionContext,
        params.targetTable,
        this.buildLinkUpdateBatches(
          params.targetTable,
          command.source.records(params.sourceTableId, { phase: 'linkRestore' }),
          params.fieldIdMap,
          sourceLinkFieldIds,
          this.resolveTableRecordBatchSize(params.targetTable, command.batchSize)
        ),
        {
          skipComputedUpdates: true,
          fillLinkTitles: true,
          assumeEmptyLinkState: true,
        }
      )
    );
    if (result.isErr()) {
      yield this.errorEvent(result.error);
    }
  }

  private resolveTableRecordBatchSize(table: Table, requestedBatchSize: number): number {
    return Math.min(
      requestedBatchSize,
      calculateBatchSize(table.getFields().length, { maxBatchSize: requestedBatchSize })
    );
  }

  private async *buildInsertBatches(
    table: Table,
    records: AsyncIterable<DuplicateBaseRecordInput>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>,
    batchSize: number,
    excludedSourceFieldIds: ReadonlySet<string> = new Set()
  ): AsyncGenerator<InsertManyStreamBatch> {
    let batch: DuplicateBaseRecordInput[] = [];
    for await (const record of records) {
      batch.push(record);
      if (batch.length >= batchSize) {
        yield this.toInsertBatch(table, batch, fieldIdMap, viewIdMap, excludedSourceFieldIds);
        batch = [];
      }
    }
    if (batch.length > 0) {
      yield this.toInsertBatch(table, batch, fieldIdMap, viewIdMap, excludedSourceFieldIds);
    }
  }

  private async *buildLinkUpdateBatches(
    table: Table,
    records: AsyncIterable<DuplicateBaseRecordInput>,
    fieldIdMap: Record<string, string>,
    sourceLinkFieldIds: ReadonlySet<string>,
    batchSize: number
  ): AsyncGenerator<Result<UpdateManyStreamBatchInput, DomainError>> {
    let batch: Array<{ recordId: RecordId; fieldValues: Map<string, unknown> }> = [];
    for await (const record of records) {
      const fieldValues = new Map<string, unknown>();
      for (const [sourceFieldId, rawValue] of Object.entries(record.fields)) {
        if (!sourceLinkFieldIds.has(sourceFieldId)) continue;
        const targetFieldId = fieldIdMap[sourceFieldId];
        if (targetFieldId) {
          fieldValues.set(targetFieldId, rawValue);
        }
      }
      if (!fieldValues.size) continue;
      if (!record.recordId) {
        yield err(
          domainError.validation({
            code: 'duplicate_base.record_id_required',
            message: 'Duplicate base link restore requires record ids in source records',
          })
        );
        return;
      }
      const recordId = RecordId.create(record.recordId);
      if (recordId.isErr()) {
        yield err(recordId.error);
        return;
      }
      batch.push({ recordId: recordId.value, fieldValues });
      if (batch.length >= batchSize) {
        yield* table.updateRecordsStream(batch, { typecast: false, batchSize });
        batch = [];
      }
    }
    if (batch.length > 0) {
      yield* table.updateRecordsStream(batch, { typecast: false, batchSize });
    }
  }

  private toInsertBatch(
    table: Table,
    batch: ReadonlyArray<DuplicateBaseRecordInput>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>,
    excludedSourceFieldIds: ReadonlySet<string> = new Set()
  ): InsertManyStreamBatch {
    const records = batch.map((record) =>
      this.toTableRecord(table, record, fieldIdMap, excludedSourceFieldIds)
    );
    return {
      records,
      restoreRecordsById: new Map(
        batch.map((record, index) => [
          records[index]!.id().toString(),
          this.toRestoreValues(record, viewIdMap),
        ])
      ),
    };
  }

  private toTableRecord(
    table: Table,
    record: DuplicateBaseRecordInput,
    fieldIdMap: Record<string, string>,
    excludedSourceFieldIds: ReadonlySet<string> = new Set()
  ): TableRecord {
    const recordIdResult = record.recordId ? RecordId.create(record.recordId) : RecordId.generate();
    if (recordIdResult.isErr()) throw recordIdResult.error;
    const fieldValues = Object.entries(record.fields).flatMap(([sourceFieldId, rawValue]) => {
      if (excludedSourceFieldIds.has(sourceFieldId)) return [];
      const targetFieldId = fieldIdMap[sourceFieldId];
      if (!targetFieldId) return [];
      const fieldId = FieldId.create(targetFieldId);
      if (fieldId.isErr()) throw fieldId.error;
      const value = TableRecordCellValue.create(rawValue);
      if (value.isErr()) throw value.error;
      return [{ fieldId: fieldId.value, value: value.value }];
    });
    const tableRecord = TableRecord.create({
      id: recordIdResult.value,
      tableId: table.id(),
      fieldValues,
    });
    if (tableRecord.isErr()) throw tableRecord.error;
    return tableRecord.value;
  }

  private getSourceLinkFieldIds(
    command: DuplicateBaseCommand,
    sourceTableId: string
  ): ReadonlySet<string> {
    const sourceTable = command.source.structure.tables.find((table) => table.id === sourceTableId);
    return new Set(
      sourceTable?.fields.flatMap((field) =>
        field.id && field.type === 'link' ? [field.id] : []
      ) ?? []
    );
  }

  private getSourceLinkRestoreFieldIds(
    command: DuplicateBaseCommand,
    sourceTableId: string
  ): ReadonlySet<string> {
    const sourceTable = command.source.structure.tables.find((table) => table.id === sourceTableId);
    return new Set(
      sourceTable?.fields.flatMap((field) => {
        if (!field.id || field.type !== 'link') {
          return [];
        }

        // The many-one side restores the FK relation; duplicate backfill rebuilds this inverse cache.
        return this.isTwoWayOneManyLink(field) ? [] : [field.id];
      }) ?? []
    );
  }

  private isTwoWayOneManyLink(field: { options?: unknown }): boolean {
    const options = field.options as { relationship?: unknown; isOneWay?: unknown } | undefined;
    return options?.relationship === 'oneMany' && options.isOneWay !== true;
  }

  private toRestoreValues(
    record: DuplicateBaseRecordInput,
    viewIdMap: Record<string, string>
  ): RecordRestoreSystemValues {
    const orders = record.orders
      ? Object.fromEntries(
          Object.entries(record.orders).flatMap(([sourceViewId, order]) => {
            const targetViewId = viewIdMap[sourceViewId];
            return targetViewId ? [[targetViewId, order]] : [];
          })
        )
      : undefined;

    return {
      ...(record.version !== undefined ? { version: record.version } : {}),
      ...(orders && Object.keys(orders).length ? { orders } : {}),
      ...(record.autoNumber !== undefined ? { autoNumber: record.autoNumber } : {}),
      ...(record.createdTime ? { createdTime: record.createdTime } : {}),
      ...(record.createdBy ? { createdBy: record.createdBy } : {}),
      lastModifiedTime: record.lastModifiedTime ?? null,
      lastModifiedBy: record.lastModifiedBy ?? null,
    };
  }

  private errorEvent(error: DomainError): DuplicateBaseEvent {
    const event: DuplicateBaseEvent = {
      id: 'error',
      message: error.message,
      code: error.code,
    };
    Object.defineProperty(event, 'error', {
      value: error,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return event;
  }
}

const tableRecordToRecordWriteFieldValues = (record: TableRecord): ReadonlyMap<string, unknown> =>
  new Map(
    record
      .fields()
      .entries()
      .map((entry) => [entry.fieldId.toString(), entry.value.toValue()] as const)
  );
