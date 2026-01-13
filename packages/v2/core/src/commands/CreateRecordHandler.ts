import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { LinkTitleResolverService } from '../application/services/LinkTitleResolverService';
import { TableQueryService } from '../application/services/TableQueryService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { TableRecord } from '../domain/table/records/TableRecord';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { CreateRecordCommand } from './CreateRecordCommand';

export class CreateRecordResult {
  private constructor(
    readonly record: TableRecord,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(record: TableRecord, events: ReadonlyArray<IDomainEvent>): CreateRecordResult {
    return new CreateRecordResult(record, [...events]);
  }
}

@CommandHandler(CreateRecordCommand)
@injectable()
export class CreateRecordHandler
  implements ICommandHandler<CreateRecordCommand, CreateRecordResult>
{
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.linkTitleResolverService)
    private readonly linkTitleResolver: LinkTitleResolverService,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: CreateRecordCommand
  ): Promise<Result<CreateRecordResult, DomainError>> {
    const handler = this;
    return safeTry<CreateRecordResult, DomainError>(async function* () {
      // 1. Get the table
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);

      // 2. Create the record (validates and applies field values internally)
      const tracer = context.tracer;
      const createRecordSpan = tracer?.startSpan('teable.CreateRecordHandler.createRecord');
      const createResult = yield* table.createRecord(command.fieldValues, {
        typecast: command.typecast,
      });

      // 3. Resolve link titles to IDs if typecast mode is enabled and spec exists
      let record = createResult.record;
      if (
        command.typecast &&
        createResult.mutateSpec &&
        handler.linkTitleResolver.needsResolution(createResult.mutateSpec)
      ) {
        const resolvedSpec = yield* await handler.linkTitleResolver.resolveAndReplace(
          context,
          createResult.mutateSpec
        );
        // Re-apply the resolved spec to get the correct record values
        record = yield* resolvedSpec.mutate(record);
      }

      try {
        const runTransaction = () =>
          handler.unitOfWork.withTransaction(context, async (transactionContext) => {
            return safeTry<void, DomainError>(async function* () {
              yield* await handler.tableRecordRepository.insert(transactionContext, table, record);
              return ok(undefined);
            });
          });
        const transactionResult =
          tracer && createRecordSpan
            ? await tracer.withSpan(createRecordSpan, runTransaction)
            : await runTransaction();
        if (transactionResult.isErr()) {
          createRecordSpan?.recordError(transactionResult.error.toString());
        }
        yield* transactionResult;
      } finally {
        createRecordSpan?.end();
      }

      // 4. Pull events from Table aggregate root and publish
      const events = table.pullDomainEvents();
      yield* await handler.eventBus.publishMany(context, events);

      return ok(CreateRecordResult.create(record, events));
    });
  }
}
