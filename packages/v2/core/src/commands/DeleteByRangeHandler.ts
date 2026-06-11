import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import {
  DeleteByRangeApplicationService,
  type DeleteByRangeResult,
} from '../application/services/DeleteByRangeApplicationService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { TraceSpan } from '../ports/TraceSpan';
import { v2CoreTokens } from '../ports/tokens';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DeleteByRangeCommand } from './DeleteByRangeCommand';

@CommandHandler(DeleteByRangeCommand)
@injectable()
export class DeleteByRangeHandler
  implements ICommandHandler<DeleteByRangeCommand, DeleteByRangeResult>
{
  constructor(
    @inject(v2CoreTokens.deleteByRangeApplicationService)
    private readonly deleteByRangeApplicationService: DeleteByRangeApplicationService
  ) {}

  @TraceSpan()
  async handle(
    context: IExecutionContext,
    command: DeleteByRangeCommand
  ): Promise<Result<DeleteByRangeResult, DomainError>> {
    return this.deleteByRangeApplicationService.delete(context, command);
  }
}
