import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableCreationService } from '../application/services/TableCreationService';
import {
  beginTablesSchemaOperation,
  completeTablesSchemaOperation,
  failTablesSchemaOperation,
} from '../application/services/TableSchemaOperationLifecycleService';
import type { BaseId } from '../domain/base/BaseId';
import type { DomainError } from '../domain/shared/DomainError';
import { domainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { validateForeignTablesForFields } from '../domain/table/fields/ForeignTableRelatedField';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import type { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import * as DotTeaParserPort from '../ports/DotTeaParser';
import type { NormalizedDotTeaStructure } from '../ports/DotTeaParser';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import type { ITableFieldInput } from '../schemas/field';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { ImportDotTeaStructureCommand } from './ImportDotTeaStructureCommand';
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

const sortTablesByForeignDependencies = (
  tables: ReadonlyArray<Table>,
  referencesByTable: ReadonlyArray<ReadonlyArray<LinkForeignTableReference>>,
  baseId: BaseId,
  internalTableIds: ReadonlySet<string>
): ReadonlyArray<Table> => {
  const entries = tables.map((table, index) => ({
    table,
    id: table.id().toString(),
    references: referencesByTable[index] ?? [],
  }));
  const idToIndex = new Map(entries.map((entry, index) => [entry.id, index] as const));
  const dependents = entries.map(() => new Set<number>());
  const inDegree = entries.map(() => 0);

  entries.forEach((entry, index) => {
    for (const ref of entry.references) {
      if (!isInternalReference(ref, baseId, internalTableIds)) continue;
      const depIndex = idToIndex.get(ref.foreignTableId.toString());
      if (depIndex === undefined || depIndex === index) continue;
      if (dependents[depIndex]!.has(index)) continue;
      dependents[depIndex]!.add(index);
      inDegree[index]! += 1;
    }
  });

  const queue = entries
    .map((_, index) => (inDegree[index] === 0 ? index : -1))
    .filter((index) => index >= 0);
  const sorted: number[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const dependent of dependents[current]!) {
      inDegree[dependent]!--;
      if (inDegree[dependent] === 0) {
        queue.push(dependent);
      }
    }
  }

  if (sorted.length !== entries.length) {
    return tables;
  }

  return sorted.map((index) => entries[index]!.table);
};

export class ImportDotTeaStructureResult {
  private constructor(
    readonly baseId: string,
    readonly tables: ReadonlyArray<{ id: string; name: string }>,
    readonly tableIdMap: Record<string, string>,
    readonly fieldIdMap: Record<string, string>,
    readonly viewIdMap: Record<string, string>
  ) {}

  static create(
    baseId: string,
    tables: ReadonlyArray<Table>,
    maps: {
      tableIdMap: Record<string, string>;
      fieldIdMap: Record<string, string>;
      viewIdMap: Record<string, string>;
    }
  ): ImportDotTeaStructureResult {
    return new ImportDotTeaStructureResult(
      baseId,
      tables.map((table) => ({
        id: table.id().toString(),
        name: table.name().toString(),
      })),
      maps.tableIdMap,
      maps.fieldIdMap,
      maps.viewIdMap
    );
  }
}

const replaceMappedIds = <T>(value: T, replacements: ReadonlyMap<string, string>): T => {
  if (value == null || replacements.size === 0) {
    return value;
  }

  let serialized = JSON.stringify(value);
  if (serialized == null) {
    return value;
  }

  for (const [sourceId, targetId] of replacements) {
    serialized = serialized.split(sourceId).join(targetId);
  }

  return JSON.parse(serialized) as T;
};

@CommandHandler(ImportDotTeaStructureCommand)
@injectable()
export class ImportDotTeaStructureHandler
  implements ICommandHandler<ImportDotTeaStructureCommand, ImportDotTeaStructureResult>
{
  constructor(
    @inject(v2CoreTokens.dotTeaParser)
    private readonly dotTeaParser: DotTeaParserPort.IDotTeaParser,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableCreationService)
    private readonly tableCreationService: TableCreationService,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: ImportDotTeaStructureCommand
  ): Promise<Result<ImportDotTeaStructureResult, DomainError>> {
    const handler = this;
    return safeTry<ImportDotTeaStructureResult, DomainError>(async function* () {
      // Use parseNormalizedStructure() which handles v1→v2 conversion in dottea package
      const normalized = yield* await handler.dotTeaParser.parseNormalizedStructure(command.source);
      if (normalized.tables.length === 0) {
        return err(
          domainError.validation({
            message: 'DotTea structure has no tables to import',
            code: 'dottea.no_tables',
          })
        );
      }

      const tableIdMap: Record<string, string> = {};
      const fieldIdMap: Record<string, string> = {};
      const viewIdMap: Record<string, string> = {};
      const tablePlans: Array<{
        tableId: string;
        fieldIds: string[];
        viewIds: string[];
      }> = [];

      for (const table of normalized.tables) {
        const targetTableId = (yield* TableId.generate()).toString();
        if (table.id) {
          tableIdMap[table.id] = targetTableId;
        }

        const fieldIds: string[] = [];
        for (const field of table.fields) {
          const targetFieldId = (yield* FieldId.generate()).toString();
          fieldIds.push(targetFieldId);
          if (field.id) {
            fieldIdMap[field.id] = targetFieldId;
          }
        }

        const viewIds: string[] = [];
        for (const view of table.views ?? []) {
          const targetViewId = (yield* ViewId.generate()).toString();
          viewIds.push(targetViewId);
          if (view.id) {
            viewIdMap[view.id] = targetViewId;
          }
        }

        tablePlans.push({ tableId: targetTableId, fieldIds, viewIds });
      }

      const replacements = new Map<string, string>([
        ...(normalized.id ? ([[normalized.id, command.baseId.toString()]] as const) : []),
        ...Object.entries(tableIdMap),
        ...Object.entries(fieldIdMap),
        ...Object.entries(viewIdMap),
      ]);

      const remapped: NormalizedDotTeaStructure = {
        tables: normalized.tables.map((table, tableIndex) => {
          const tablePlan = tablePlans[tableIndex]!;
          return {
            ...table,
            id: tablePlan.tableId,
            fields: table.fields.map((field, fieldIndex) => ({
              ...field,
              id: tablePlan.fieldIds[fieldIndex]!,
              options: replaceMappedIds(field.options, replacements),
              config: replaceMappedIds(field.config, replacements),
            })),
            views: table.views?.map((view, viewIndex) => ({
              ...view,
              id: tablePlan.viewIds[viewIndex]!,
            })),
          };
        }),
      };

      // Build tables directly using TableInputParser (no CreateTableCommand dependency)
      const totalTables = remapped.tables.length;
      const buildResults = yield* sequence(
        remapped.tables.map((table, tableIndex) => {
          const tableId = table.id ?? tablePlans[tableIndex]!.tableId;
          const tableName = table.name ?? `Table ${tableIndex + 1}`;

          command.onProgress?.({
            phase: 'table_structure_started',
            tableId,
            tableName,
            tableIndex: tableIndex + 1,
            totalTables,
          });

          return buildTableFromInput(
            {
              baseId: command.baseId.toString(),
              tableId,
              name: tableName,
              // Cast fields to ITableFieldInput[] - the normalized structure already has valid field types
              fields: table.fields.map((field) => ({
                id: field.id,
                dbFieldName: field.dbFieldName,
                type: field.type as ITableFieldInput['type'],
                name: field.name,
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
            {
              executionContext: context,
            }
          );
        })
      );

      // Extract tables and foreign references from build results
      const builtTables = buildResults.map((r) => r.table);
      const recordCountByTableId = Object.fromEntries(
        builtTables.map((table) => [table.id().toString(), 0])
      );
      const referencesByTable = buildResults.map((r) => r.foreignTableReferences);

      // Collect and filter foreign table references
      command.onProgress?.({
        phase: 'table_structure_validating',
      });
      const allReferences = uniqueForeignTableReferences(referencesByTable.flat());
      const internalTableIds = new Set(builtTables.map((t) => t.id().toString()));
      const externalReferences = allReferences.filter(
        (ref) => !isInternalReference(ref, command.baseId, internalTableIds)
      );

      // Load external/foreign tables
      const externalTables = yield* await handler.foreignTableLoaderService.load(context, {
        baseId: command.baseId,
        references: externalReferences,
      });

      // Validate foreign tables for all fields
      const foreignTables = [...externalTables, ...builtTables];
      const tablesForValidation = sortTablesByForeignDependencies(
        builtTables,
        referencesByTable,
        command.baseId,
        internalTableIds
      );
      for (const table of tablesForValidation) {
        yield* validateForeignTablesForFields(table.getFields(), {
          hostTable: table,
          foreignTables,
        });
      }

      // Execute table creation using TableCreationService
      command.onProgress?.({
        phase: 'table_structure_committing',
      });
      const creationInput = {
        baseId: command.baseId,
        tables: builtTables,
        externalTables,
        referencesByTable,
      };
      const persistedTables = yield* await handler.unitOfWork.withTransaction(
        context,
        async (metaTransactionContext) =>
          safeTry<ReadonlyArray<Table>, DomainError>(async function* () {
            const metadataResult = yield* await handler.tableCreationService.persistMetadata(
              metaTransactionContext,
              {
                baseId: command.baseId,
                tables: builtTables,
                externalTables,
                referencesByTable,
              }
            );
            yield* await beginTablesSchemaOperation(
              handler.unitOfWork,
              handler.tableRepository,
              metaTransactionContext,
              metadataResult.persistedTables,
              {
                type: 'table.import',
                payload: {
                  baseId: command.baseId.toString(),
                  source: 'dottea',
                  recordCountByTableId,
                },
              }
            );
            return ok(metadataResult.persistedTables);
          }),
        { scope: 'meta' }
      );

      const provisionResult = await handler.unitOfWork.withTransaction(
        context,
        async (dataTransactionContext) =>
          handler.tableCreationService.provisionData(dataTransactionContext, {
            baseId: command.baseId,
            tables: builtTables,
            externalTables,
            referencesByTable,
            persistedTables,
          }),
        { scope: 'data' }
      );
      if (provisionResult.isErr()) {
        yield* await failTablesSchemaOperation(
          handler.unitOfWork,
          handler.tableRepository,
          context,
          persistedTables,
          {
            lastError: provisionResult.error.message,
            type: 'table.import',
            payload: {
              baseId: command.baseId.toString(),
              source: 'dottea',
              recordCountByTableId,
            },
          }
        );
        return err(provisionResult.error);
      }

      yield* await completeTablesSchemaOperation(
        handler.unitOfWork,
        handler.tableRepository,
        context,
        persistedTables,
        { type: 'table.import' }
      );

      // Build and publish events
      const hostEvents = builtTables.flatMap((table) => table.pullDomainEvents());
      const events = [...hostEvents, ...provisionResult.value.sideEffectEvents];
      yield* await handler.eventBus.publishMany(context, events);

      const resultTables = provisionResult.value.persistedTables.map(
        (table) => provisionResult.value.tableState.get(table.id().toString()) ?? table
      );

      resultTables.forEach((table, tableIndex) => {
        command.onProgress?.({
          phase: 'table_structure_done',
          tableId: table.id().toString(),
          tableName: table.name().toString(),
          tableIndex: tableIndex + 1,
          totalTables,
        });
      });

      return ok(
        ImportDotTeaStructureResult.create(command.baseId.toString(), resultTables, {
          tableIdMap,
          fieldIdMap,
          viewIdMap,
        })
      );
    });
  }
}
