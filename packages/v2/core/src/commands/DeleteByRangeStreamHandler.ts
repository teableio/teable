import { inject, injectable } from '@teable/v2-di';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  DeleteByRangeApplicationService,
  type DeleteByRangeStreamEvent,
} from '../application/services/DeleteByRangeApplicationService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { TraceSpan } from '../ports/TraceSpan';
import { v2CoreTokens } from '../ports/tokens';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DeleteByRangeStreamCommand } from './DeleteByRangeStreamCommand';

export type DeleteByRangeStreamResult = AsyncIterable<DeleteByRangeStreamEvent>;

@CommandHandler(DeleteByRangeStreamCommand)
@injectable()
export class DeleteByRangeStreamHandler
  implements ICommandHandler<DeleteByRangeStreamCommand, DeleteByRangeStreamResult>
{
  constructor(
    @inject(v2CoreTokens.deleteByRangeApplicationService)
    private readonly deleteByRangeApplicationService: DeleteByRangeApplicationService
  ) {}

  @TraceSpan()
  async handle(
    context: IExecutionContext,
    command: DeleteByRangeStreamCommand
  ): Promise<Result<DeleteByRangeStreamResult, DomainError>> {
    return ok(this.deleteByRangeApplicationService.createStream(context, command));
  }
}
