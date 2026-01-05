import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { AbstractTableUpdatedEvent } from '../domain/table/events/AbstractTableUpdatedEvent';
import { validateForeignTablesForFields } from '../domain/table/fields/ForeignTableRelatedField';
import { FieldCreationSideEffectVisitor } from '../domain/table/fields/visitors/FieldCreationSideEffectVisitor';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { Table } from '../domain/table/Table';
import { TableUpdateResult } from '../domain/table/TableMutator';
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
import { buildTable } from './CreateTableCommand';
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
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
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
        const validationResult = validateForeignTablesForFields(table.getFields(), {
          hostTable: table,
          foreignTables,
        });
        if (validationResult.isErr()) return err(validationResult.error);
      }

      const transactionResult = yield* await handler.unitOfWork.withTransaction(
        context,
        async (transactionContext) => {
          return safeTry<TransactionResult, DomainError>(async function* () {
            const persistedTables: Table[] = [];
            const persistedById = new Map<string, Table>();

            for (const table of builtTables) {
              const persisted = yield* await handler.tableRepository.insert(
                transactionContext,
                table
              );
              yield* await handler.tableSchemaRepository.insert(transactionContext, persisted);
              persistedTables.push(persisted);
              persistedById.set(persisted.id().toString(), persisted);
            }

            const tableState = new Map<string, Table>();
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

              const sideEffects = yield* FieldCreationSideEffectVisitor.collect(
                persistedTable.getFields(),
                {
                  table: persistedTable,
                  foreignTables: [...tableState.values()],
                }
              );

              for (const sideEffect of sideEffects) {
                const foreignTableId = sideEffect.foreignTable.id().toString();
                const foreignTable = tableState.get(foreignTableId);
                if (!foreignTable)
                  return err(domainError.notFound({ message: 'Foreign table not found in state' }));

                const updateResult = yield* await handler.tableUpdateFlow.execute(
                  transactionContext,
                  { table: foreignTable },
                  (candidate) =>
                    sideEffect.mutateSpec
                      .mutate(candidate)
                      .map((updated) => TableUpdateResult.create(updated, sideEffect.mutateSpec)),
                  { publishEvents: false }
                );

                tableState.set(updateResult.table.id().toString(), updateResult.table);
                sideEffectEvents.push(...updateResult.events);
              }
            }

            for (let index = 0; index < tableCommands.length; index += 1) {
              const persistedTable = persistedTables[index];
              const recordsFieldValues = tableCommands[index]?.records ?? [];
              if (!persistedTable || recordsFieldValues.length === 0) continue;

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
