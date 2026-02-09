import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableCreationService } from '../application/services/TableCreationService';
import type { BaseId } from '../domain/base/BaseId';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { validateForeignTablesForFields } from '../domain/table/fields/ForeignTableRelatedField';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import type { Table } from '../domain/table/Table';
import type { TableId } from '../domain/table/TableId';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { buildTable, type CreateTableRecordSeed } from './CreateTableCommand';
import { CreateTablesCommand } from './CreateTablesCommand';

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

type TransactionResult = {
  persistedTables: ReadonlyArray<Table>;
  tableState: ReadonlyMap<string, Table>;
  sideEffectEvents: ReadonlyArray<IDomainEvent>;
};

@CommandHandler(CreateTablesCommand)
@injectable()
export class CreateTablesHandler
  implements ICommandHandler<CreateTablesCommand, CreateTablesResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
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
    command: CreateTablesCommand
  ): Promise<Result<CreateTablesResult, DomainError>> {
    const handler = this;
    return safeTry<CreateTablesResult, DomainError>(async function* () {
      const tableCommands = command.tables;

      // Collect foreign table references
      const referencesByTable = yield* sequence(
        tableCommands.map((tableCommand) => tableCommand.foreignTableReferences())
      );
      const allReferences = uniqueForeignTableReferences(referencesByTable.flat());
      const internalTableIds = new Set(command.tableIds().map((tableId) => tableId.toString()));
      const externalReferences = allReferences.filter(
        (ref) => !isInternalReference(ref, command.baseId, internalTableIds)
      );

      // Load external/foreign tables
      const externalTables = yield* await handler.foreignTableLoaderService.load(context, {
        baseId: command.baseId,
        references: externalReferences,
      });

      // Build Table domain objects from commands
      const builtTables = yield* sequence(
        tableCommands.map((tableCommand) => buildTable(tableCommand))
      );

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

      // Execute table creation and record insertion in a single transaction
      const transactionResult = yield* await handler.unitOfWork.withTransaction(
        context,
        async (transactionContext) => {
          return safeTry<TransactionResult, DomainError>(async function* () {
            // Use TableCreationService for table creation and side effects
            const creationResult = yield* await handler.tableCreationService.execute(
              transactionContext,
              {
                baseId: command.baseId,
                tables: builtTables,
                externalTables,
                referencesByTable,
              }
            );

            // Build list of tables with their records for dependency sorting
            const tablesWithRecords: TableWithRecords[] = [];
            for (let index = 0; index < tableCommands.length; index += 1) {
              const persistedTable = creationResult.persistedTables[index];
              const recordsFieldValues = tableCommands[index]?.records ?? [];
              if (persistedTable && recordsFieldValues.length > 0) {
                tablesWithRecords.push({
                  tableId: persistedTable.id(),
                  table: persistedTable,
                  recordsFieldValues,
                });
              }
            }

            // Sort tables by record-level dependencies and insert records
            const sortedTablesWithRecords = sortTablesByRecordDependencies(tablesWithRecords);

            for (const { table: persistedTable, recordsFieldValues } of sortedTablesWithRecords) {
              const recordSpan = transactionContext.tracer?.startSpan(
                'teable.CreateTablesHandler.createRecords'
              );
              const { records } = yield* persistedTable.createRecords(recordsFieldValues);
              recordSpan?.end();
              yield* await handler.tableRecordRepository.insertMany(
                transactionContext,
                persistedTable,
                records
              );
            }

            return ok({
              persistedTables: creationResult.persistedTables,
              tableState: creationResult.tableState,
              sideEffectEvents: creationResult.sideEffectEvents,
            });
          });
        }
      );

      // Build and publish events
      const hostEvents = builtTables.flatMap((table) => table.pullDomainEvents());
      const recordEvents = [...transactionResult.tableState.values()].flatMap((table) =>
        table.pullDomainEvents()
      );
      const events = [...hostEvents, ...recordEvents, ...transactionResult.sideEffectEvents];
      yield* await handler.eventBus.publishMany(context, events);

      const resultTables = transactionResult.persistedTables.map(
        (table) => transactionResult.tableState.get(table.id().toString()) ?? table
      );

      return ok(CreateTablesResult.create(resultTables, events));
    });
  }
}
