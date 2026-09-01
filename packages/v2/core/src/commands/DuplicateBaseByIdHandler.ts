import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { Base } from '../domain/base/Base';
import { BaseName } from '../domain/base/BaseName';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { TableByBaseIdSpec } from '../domain/table/specs/TableByBaseIdSpec';
import type { Table } from '../domain/table/Table';
import * as BaseRepositoryPort from '../ports/BaseRepository';
import * as CommandBusPort from '../ports/CommandBus';
import type { NormalizedDotTeaField, NormalizedDotTeaStructure } from '../ports/DotTeaParser';
import * as EventBusPort from '../ports/EventBus';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as TableMapperPort from '../ports/mappers/TableMapper';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DeleteTableCommand } from './DeleteTableCommand';
import { DuplicateBaseByIdCommand } from './DuplicateBaseByIdCommand';
import {
  DuplicateBaseCommand,
  type DuplicateBaseDoneEvent,
  type DuplicateBaseErrorEvent,
  type DuplicateBaseResult,
  type DuplicateBaseSource,
} from './DuplicateBaseCommand';

const errorFromDuplicateEvent = (event: DuplicateBaseErrorEvent): DomainError => {
  if (event.error) return event.error;
  const params = {
    code: event.code ?? 'duplicate_base.failed',
    message: event.message,
  };
  return domainError.unexpected(params);
};

export class DuplicateBaseByIdResult {
  private constructor(
    readonly base: Base,
    readonly tableIdMap: Readonly<Record<string, string>>,
    readonly fieldIdMap: Readonly<Record<string, string>>,
    readonly viewIdMap: Readonly<Record<string, string>>,
    readonly recordsLength: number,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(
    base: Base,
    duplicate: DuplicateBaseDoneEvent,
    events: ReadonlyArray<IDomainEvent>
  ): DuplicateBaseByIdResult {
    return new DuplicateBaseByIdResult(
      base,
      duplicate.tableIdMap,
      duplicate.fieldIdMap,
      duplicate.viewIdMap,
      duplicate.recordsLength,
      [...events]
    );
  }
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const toNormalizedField = (
  field: TableMapperPort.ITableFieldPersistenceDTO,
  primaryFieldId: string
): NormalizedDotTeaField => {
  const lookupOptions = 'lookupOptions' in field ? asRecord(field.lookupOptions) : undefined;
  const options = field.isLookup ? lookupOptions : asRecord(field.options);
  const config = 'config' in field ? asRecord(field.config) : undefined;

  return {
    id: field.id,
    name: field.name,
    type: field.isLookup ? 'lookup' : field.type,
    isPrimary: field.id === primaryFieldId,
    ...(field.dbFieldName ? { dbFieldName: field.dbFieldName } : {}),
    ...(field.description !== undefined ? { description: field.description } : {}),
    ...(field.aiConfig !== undefined ? { aiConfig: field.aiConfig } : {}),
    ...(field.notNull !== undefined ? { notNull: field.notNull } : {}),
    ...(field.unique !== undefined ? { unique: field.unique } : {}),
    ...(options ? { options } : {}),
    ...(config ? { config } : {}),
    ...('cellValueType' in field && field.cellValueType
      ? { cellValueType: field.cellValueType }
      : {}),
    ...(field.isMultipleCellValue !== undefined
      ? { isMultipleCellValue: field.isMultipleCellValue }
      : {}),
  };
};

@CommandHandler(DuplicateBaseByIdCommand)
@injectable()
export class DuplicateBaseByIdHandler
  implements ICommandHandler<DuplicateBaseByIdCommand, DuplicateBaseByIdResult>
{
  constructor(
    @inject(v2CoreTokens.baseRepository)
    private readonly baseRepository: BaseRepositoryPort.IBaseRepository,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: TableMapperPort.ITableMapper,
    @inject(v2CoreTokens.internalCommandBus)
    private readonly commandBus: CommandBusPort.ICommandBus,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  async handle(
    context: IExecutionContext,
    command: DuplicateBaseByIdCommand
  ): Promise<Result<DuplicateBaseByIdResult, DomainError>> {
    const handler = this;
    return safeTry<DuplicateBaseByIdResult, DomainError>(async function* () {
      const sourceBase = yield* await handler.baseRepository.findOne(context, command.sourceBaseId);
      if (!sourceBase) {
        return err(
          domainError.notFound({
            code: 'base.not_found',
            message: 'Source base not found',
            details: { baseId: command.sourceBaseId.toString() },
          })
        );
      }

      const sourceTables = yield* await handler.tableRepository.find(
        context,
        TableByBaseIdSpec.create(command.sourceBaseId)
      );
      const snapshot = yield* handler.toSnapshot(sourceTables, command.sourceBaseId.toString());

      const targetName =
        command.baseName ?? (yield* BaseName.create(`${sourceBase.name().toString()} (Copy)`));

      const baseBuilder = Base.builder().withName(targetName);
      if (command.targetBaseId) baseBuilder.withId(command.targetBaseId);
      const targetBase = yield* baseBuilder.build();

      yield* await handler.unitOfWork.withTransaction(
        context,
        async (transactionContext) => handler.baseRepository.insert(transactionContext, targetBase),
        { scope: 'meta' }
      );

      const source = handler.createSource(
        context,
        snapshot.structure,
        snapshot.tableSnapshots,
        new Map(sourceTables.map((table) => [table.id().toString(), table])),
        command.batchSize
      );
      const duplicateResult = await handler.executeDuplicate(context, targetBase, source, command);
      if (duplicateResult.isErr()) {
        const cleanupResult = await handler.cleanupFailedDuplicate(context, targetBase);
        if (cleanupResult.isErr()) {
          return err(
            domainError.infrastructure({
              code: 'duplicate_base.cleanup_failed',
              message: `${duplicateResult.error.message}; cleanup failed: ${cleanupResult.error.message}`,
              details: {
                duplicateErrorCode: duplicateResult.error.code,
                cleanupErrorCode: cleanupResult.error.code,
              },
              cause: duplicateResult.error,
            })
          );
        }
        return err(duplicateResult.error);
      }
      const duplicate = duplicateResult.value;

      const events = targetBase.pullDomainEvents();
      yield* await handler.eventBus.publishMany(context, events);
      return ok(DuplicateBaseByIdResult.create(targetBase, duplicate, events));
    });
  }

  private async executeDuplicate(
    context: IExecutionContext,
    targetBase: Base,
    source: DuplicateBaseSource,
    command: DuplicateBaseByIdCommand
  ): Promise<Result<DuplicateBaseDoneEvent, DomainError>> {
    const handler = this;
    return safeTry<DuplicateBaseDoneEvent, DomainError>(async function* () {
      const duplicateCommand = yield* DuplicateBaseCommand.createFromSource({
        baseId: targetBase.id().toString(),
        source,
        withRecords: command.withRecords,
        batchSize: command.batchSize,
      });
      const stream = yield* await handler.commandBus.execute<
        DuplicateBaseCommand,
        DuplicateBaseResult
      >(context, duplicateCommand);

      let done: DuplicateBaseDoneEvent | undefined;
      for await (const event of stream) {
        if (event.id === 'error') return err(errorFromDuplicateEvent(event));
        if (event.id === 'done') done = event;
      }
      if (!done) {
        return err(
          domainError.invariant({
            code: 'duplicate_base.missing_result',
            message: 'Duplicate base completed without a result',
          })
        );
      }
      return ok(done);
    });
  }

  private async cleanupFailedDuplicate(
    context: IExecutionContext,
    targetBase: Base
  ): Promise<Result<void, DomainError>> {
    const handler = this;
    return safeTry<void, DomainError>(async function* () {
      const tables = yield* await handler.tableRepository.find(
        context,
        TableByBaseIdSpec.create(targetBase.id()),
        { state: 'all' }
      );
      for (const table of [...tables].reverse()) {
        const deleteCommand = yield* DeleteTableCommand.create({
          baseId: targetBase.id().toString(),
          tableId: table.id().toString(),
          mode: 'permanent',
        });
        yield* await handler.commandBus.execute<DeleteTableCommand, unknown>(
          context,
          deleteCommand
        );
      }
      yield* await handler.unitOfWork.withTransaction(
        context,
        async (transactionContext) =>
          handler.baseRepository.delete(transactionContext, targetBase.id()),
        { scope: 'meta' }
      );
      return ok(undefined);
    });
  }

  private toSnapshot(
    tables: ReadonlyArray<Table>,
    sourceBaseId: string
  ): Result<
    {
      structure: NormalizedDotTeaStructure;
      tableSnapshots: ReadonlyMap<string, TableMapperPort.ITablePersistenceDTO>;
    },
    DomainError
  > {
    const mapped = tables.map((table) => this.tableMapper.toDTO(table));
    const firstError = mapped.find((result) => result.isErr());
    if (firstError?.isErr()) return err(firstError.error);

    const snapshots = mapped.map((result) => result._unsafeUnwrap());
    return ok({
      structure: {
        id: sourceBaseId,
        tables: snapshots.map((dto) => ({
          id: dto.id,
          name: dto.name,
          fields: dto.fields.map((field) => toNormalizedField(field, dto.primaryFieldId)),
          views: dto.views.map((view) => ({ id: view.id, name: view.name, type: view.type })),
        })),
      },
      tableSnapshots: new Map(snapshots.map((dto) => [dto.id, dto])),
    });
  }

  private createSource(
    context: IExecutionContext,
    structure: NormalizedDotTeaStructure,
    tableSnapshots: ReadonlyMap<string, TableMapperPort.ITablePersistenceDTO>,
    tablesById: ReadonlyMap<string, Table>,
    batchSize: number
  ): DuplicateBaseSource {
    const recordRepository = this.tableRecordQueryRepository;
    return {
      structure,
      tableSnapshots,
      async *records(tableId: string) {
        const table = tablesById.get(tableId);
        if (!table) return;

        for await (const recordResult of recordRepository.findStream(context, table, undefined, {
          mode: 'stored',
          includeOrders: true,
          batchSize,
        })) {
          if (recordResult.isErr()) throw recordResult.error;
          const record = recordResult.value;
          yield {
            recordId: record.id,
            fields: record.fields,
            version: record.version,
            orders: record.orders,
            autoNumber: record.autoNumber,
            createdTime: record.createdTime,
            createdBy: record.createdBy,
            lastModifiedTime: record.lastModifiedTime,
            lastModifiedBy: record.lastModifiedBy,
          };
        }
      },
    };
  }
}
