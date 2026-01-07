import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import type { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { AbstractTableUpdatedEvent } from '../domain/table/events/AbstractTableUpdatedEvent';
import { validateForeignTablesForFields } from '../domain/table/fields/ForeignTableRelatedField';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { Table } from '../domain/table/Table';
import type { TableId } from '../domain/table/TableId';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import type { ITablePersistenceDTO } from '../ports/mappers/TableMapper';
import * as TableMapperPort from '../ports/mappers/TableMapper';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import * as TableSchemaRepositoryPort from '../ports/TableSchemaRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { buildTable, type CreateTableRecordSeed } from './CreateTableCommand';
import { CreateTablesCommand } from './CreateTablesCommand';

type TransactionResult = {
  persistedTables: ReadonlyArray<Table>;
  tableState: ReadonlyMap<string, Table>;
  sideEffectEvents: ReadonlyArray<IDomainEvent>;
};

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

type TableWithRecords = {
  tableId: TableId;
  table: Table;
  recordsFieldValues: ReadonlyArray<CreateTableRecordSeed>;
};

/**
 * Extracts record IDs from link field values in the input records.
 * Returns record IDs that the records in this table reference.
 */
const extractReferencedRecordIds = (records: ReadonlyArray<CreateTableRecordSeed>): Set<string> => {
  const referencedIds = new Set<string>();

  for (const record of records) {
    for (const value of record.fieldValues.values()) {
      // Link values can be { id: string } or [{ id: string }]
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'string') {
              referencedIds.add(item.id);
            }
          }
        } else if ('id' in value && typeof value.id === 'string') {
          referencedIds.add(value.id);
        }
      }
    }
  }

  return referencedIds;
};

/**
 * Extracts record IDs defined in the input records.
 * Returns record IDs that are being created in this table.
 */
const extractDefinedRecordIds = (records: ReadonlyArray<CreateTableRecordSeed>): Set<string> => {
  const definedIds = new Set<string>();

  for (const record of records) {
    if (record.id) {
      definedIds.add(record.id.toString());
    }
  }

  return definedIds;
};

/**
 * Sorts tables by record-level dependencies using topological sort.
 * Tables whose records are referenced by other tables' records should be inserted first.
 */
const sortTablesByRecordDependencies = (
  tablesWithRecords: ReadonlyArray<TableWithRecords>
): ReadonlyArray<TableWithRecords> => {
  // Build a map of record ID -> table index
  const recordIdToTableIndex = new Map<string, number>();
  for (let i = 0; i < tablesWithRecords.length; i++) {
    const definedIds = extractDefinedRecordIds(tablesWithRecords[i]!.recordsFieldValues);
    for (const id of definedIds) {
      recordIdToTableIndex.set(id, i);
    }
  }

  // Build adjacency list for dependencies
  // edge: tableA -> tableB means tableA's records reference tableB's records
  const dependencies: Set<number>[] = tablesWithRecords.map(() => new Set());
  for (let i = 0; i < tablesWithRecords.length; i++) {
    const referencedIds = extractReferencedRecordIds(tablesWithRecords[i]!.recordsFieldValues);
    for (const refId of referencedIds) {
      const depTableIndex = recordIdToTableIndex.get(refId);
      if (depTableIndex !== undefined && depTableIndex !== i) {
        dependencies[i]!.add(depTableIndex);
      }
    }
  }

  // Topological sort using Kahn's algorithm
  const inDegree = tablesWithRecords.map(() => 0);
  for (const deps of dependencies) {
    for (const dep of deps) {
      inDegree[dep]!++;
    }
  }

  // Queue: tables with no incoming edges (no one depends on them for record references)
  const queue: number[] = [];
  for (let i = 0; i < inDegree.length; i++) {
    if (inDegree[i] === 0) {
      queue.push(i);
    }
  }

  // Process in reverse: tables that are depended on should come first
  const sorted: number[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const dep of dependencies[current]!) {
      inDegree[dep]!--;
      if (inDegree[dep] === 0) {
        queue.push(dep);
      }
    }
  }

  // Reverse to get the correct order (tables that are referenced first)
  sorted.reverse();

  // If there's a cycle, fall back to original order
  if (sorted.length !== tablesWithRecords.length) {
    return tablesWithRecords;
  }

  return sorted.map((index) => tablesWithRecords[index]!);
};

export class CreateTablesResult {
  private constructor(
    readonly tables: ReadonlyArray<Table>,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(
    tables: ReadonlyArray<Table>,
    events: ReadonlyArray<IDomainEvent>
  ): CreateTablesResult {
    return new CreateTablesResult([...tables], [...events]);
  }
}

@CommandHandler(CreateTablesCommand)
@injectable()
export class CreateTablesHandler
  implements ICommandHandler<CreateTablesCommand, CreateTablesResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableSchemaRepository)
    private readonly tableSchemaRepository: TableSchemaRepositoryPort.ITableSchemaRepository,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.fieldCreationSideEffectService)
    private readonly fieldCreationSideEffectService: FieldCreationSideEffectService,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: TableMapperPort.ITableMapper,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: CreateTablesCommand
  ): Promise<Result<CreateTablesResult, DomainError>> {
    const handler = this;
    return safeTry<CreateTablesResult, DomainError>(async function* () {
      const tableCommands = command.tables;

      const referencesByTable = yield* sequence(
        tableCommands.map((tableCommand) => tableCommand.foreignTableReferences())
      );
      const allReferences = uniqueForeignTableReferences(referencesByTable.flat());
      const internalTableIds = new Set(command.tableIds().map((tableId) => tableId.toString()));
      const externalReferences = allReferences.filter(
        (ref) => !isInternalReference(ref, command.baseId, internalTableIds)
      );

      const externalTables = yield* await handler.foreignTableLoaderService.load(context, {
        baseId: command.baseId,
        references: externalReferences,
      });

      const builtTables = yield* sequence(
        tableCommands.map((tableCommand) => buildTable(tableCommand))
      );

      const foreignTables = [...externalTables, ...builtTables];
      for (const table of builtTables) {
        yield* validateForeignTablesForFields(table.getFields(), {
          hostTable: table,
          foreignTables,
        });
      }

      const transactionResult = yield* await handler.unitOfWork.withTransaction(
        context,
        async (transactionContext) => {
          return safeTry<TransactionResult, DomainError>(async function* () {
            const persistedTables = yield* await handler.tableRepository.insertMany(
              transactionContext,
              builtTables
            );
            yield* await handler.tableSchemaRepository.insertMany(
              transactionContext,
              persistedTables
            );
            const persistedById = new Map(
              persistedTables.map((table) => [table.id().toString(), table] as const)
            );

            let tableState = new Map<string, Table>();
            for (const table of externalTables) {
              tableState.set(table.id().toString(), table);
            }
            for (const table of persistedTables) {
              tableState.set(table.id().toString(), table);
            }

            const sideEffectEvents: IDomainEvent[] = [];

            for (const table of builtTables) {
              const persistedTable = persistedById.get(table.id().toString());
              if (!persistedTable) {
                return err(domainError.notFound({ message: 'Persisted table not found' }));
              }

              const sideEffectResult = yield* await handler.fieldCreationSideEffectService.execute(
                transactionContext,
                {
                  table: persistedTable,
                  fields: persistedTable.getFields(),
                  foreignTables: [...tableState.values()],
                  tableState,
                }
              );
              sideEffectEvents.push(...sideEffectResult.events);
              tableState = new Map(sideEffectResult.tableState);
            }

            // Build list of tables with their records for dependency sorting
            const tablesWithRecords: TableWithRecords[] = [];
            for (let index = 0; index < tableCommands.length; index += 1) {
              const persistedTable = persistedTables[index];
              const recordsFieldValues = tableCommands[index]?.records ?? [];
              if (persistedTable && recordsFieldValues.length > 0) {
                tablesWithRecords.push({
                  tableId: persistedTable.id(),
                  table: persistedTable,
                  recordsFieldValues,
                });
              }
            }

            // Sort tables by record-level dependencies
            const sortedTablesWithRecords = sortTablesByRecordDependencies(tablesWithRecords);

            // Insert records in dependency order
            for (const { table: persistedTable, recordsFieldValues } of sortedTablesWithRecords) {
              const recordSpan = transactionContext.tracer?.startSpan(
                'teable.CreateTablesHandler.createRecords'
              );
              const records = yield* persistedTable.createRecords(recordsFieldValues);
              recordSpan?.end();
              yield* await handler.tableRecordRepository.insertMany(
                transactionContext,
                persistedTable,
                records
              );
            }

            return ok({
              persistedTables,
              tableState,
              sideEffectEvents,
            });
          });
        }
      );

      const hostEvents = builtTables.flatMap((table) => table.pullDomainEvents());
      const events = [...hostEvents, ...transactionResult.sideEffectEvents];
      const snapshots = yield* handler.buildSnapshots(transactionResult.tableState);
      const enrichedEvents = yield* await handler.enrichEventsWithSnapshots(
        context,
        events,
        snapshots
      );
      yield* await handler.eventBus.publishMany(context, enrichedEvents);

      const resultTables = transactionResult.persistedTables.map(
        (table) => transactionResult.tableState.get(table.id().toString()) ?? table
      );

      return ok(CreateTablesResult.create(resultTables, enrichedEvents));
    });
  }

  private buildSnapshots(
    tableState: ReadonlyMap<string, Table>
  ): Result<ReadonlyMap<string, ITablePersistenceDTO>, DomainError> {
    const snapshots = new Map<string, ITablePersistenceDTO>();
    for (const table of tableState.values()) {
      const snapshotResult = this.tableMapper.toDTO(table);
      if (snapshotResult.isErr()) return err(snapshotResult.error);
      snapshots.set(table.id().toString(), snapshotResult.value);
    }
    return ok(snapshots);
  }

  private async enrichEventsWithSnapshots(
    context: ExecutionContextPort.IExecutionContext,
    events: ReadonlyArray<IDomainEvent>,
    snapshots: ReadonlyMap<string, ITablePersistenceDTO>
  ): Promise<Result<ReadonlyArray<IDomainEvent>, DomainError>> {
    const handler = this;
    return safeTry<ReadonlyArray<IDomainEvent>, DomainError>(async function* () {
      const snapshotMap = new Map(snapshots);
      const enriched: IDomainEvent[] = [];

      for (const event of events) {
        if (!(event instanceof AbstractTableUpdatedEvent) || event.hasSnapshot()) {
          enriched.push(event);
          continue;
        }

        const tableId = event.tableId.toString();
        let snapshot = snapshotMap.get(tableId);
        if (!snapshot) {
          const spec = yield* Table.specs(event.baseId).byId(event.tableId).build();
          const tableResult = yield* await handler.tableRepository.findOne(context, spec);
          const snapshotResult = handler.tableMapper.toDTO(tableResult);
          if (snapshotResult.isErr()) return err(snapshotResult.error);
          snapshot = snapshotResult.value;
          snapshotMap.set(tableId, snapshot);
        }

        enriched.push(event.withSnapshot(snapshot));
      }

      return ok(enriched);
    });
  }
}
