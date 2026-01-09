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
import { UpdateRecordCommand } from './UpdateRecordCommand';

export class UpdateRecordResult {
  private constructor(
    readonly record: TableRecord,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(record: TableRecord, events: ReadonlyArray<IDomainEvent>): UpdateRecordResult {
    return new UpdateRecordResult(record, [...events]);
  }
}

@CommandHandler(UpdateRecordCommand)
@injectable()
export class UpdateRecordHandler
  implements ICommandHandler<UpdateRecordCommand, UpdateRecordResult>
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
    command: UpdateRecordCommand
  ): Promise<Result<UpdateRecordResult, DomainError>> {
    const handler = this;
    return safeTry<UpdateRecordResult, DomainError>(async function* () {
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);

      const updateRecordSpan = context.tracer?.startSpan('teable.UpdateRecordHandler.updateRecord');
      const recordUpdateResult = yield* table.updateRecord(command.recordId, command.fieldValues, {
        typecast: command.typecast,
      });
      updateRecordSpan?.end();

      // Resolve link titles to IDs if typecast mode is enabled
      let mutateSpec = recordUpdateResult.mutateSpec;
      if (command.typecast && handler.linkTitleResolver.needsResolution(mutateSpec)) {
        mutateSpec = yield* await handler.linkTitleResolver.resolveAndReplace(context, mutateSpec);
      }

      yield* await handler.unitOfWork.withTransaction(context, async (transactionContext) => {
        return safeTry<void, DomainError>(async function* () {
          yield* await handler.tableRecordRepository.updateOne(
            transactionContext,
            table,
            command.recordId,
            mutateSpec
          );
          return ok(undefined);
        });
      });

      const events: IDomainEvent[] = [];
      yield* await handler.eventBus.publishMany(context, events);

      return ok(UpdateRecordResult.create(recordUpdateResult.record, events));
    });
  }
}
