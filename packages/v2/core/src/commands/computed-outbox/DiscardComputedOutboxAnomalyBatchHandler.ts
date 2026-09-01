import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { DiscardComputedOutboxAnomalyBatchResult } from '../../domain/computed/outbox';
import type { DomainError } from '../../domain/shared/DomainError';
import { IComputedOutboxAdmin } from '../../ports/ComputedOutboxAdmin';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { CommandHandler, type ICommandHandler } from '../CommandHandler';
import { DiscardComputedOutboxAnomalyBatchCommand } from './DiscardComputedOutboxAnomalyBatchCommand';

export class DiscardComputedOutboxAnomalyBatchCommandResult {
  private constructor(readonly discard: DiscardComputedOutboxAnomalyBatchResult) {}

  static create(
    discard: DiscardComputedOutboxAnomalyBatchResult
  ): DiscardComputedOutboxAnomalyBatchCommandResult {
    return new DiscardComputedOutboxAnomalyBatchCommandResult(discard);
  }
}

@CommandHandler(DiscardComputedOutboxAnomalyBatchCommand)
@injectable()
export class DiscardComputedOutboxAnomalyBatchHandler
  implements
    ICommandHandler<
      DiscardComputedOutboxAnomalyBatchCommand,
      DiscardComputedOutboxAnomalyBatchCommandResult
    >
{
  constructor(
    @inject(v2CoreTokens.computedOutboxAdmin)
    private readonly admin: IComputedOutboxAdmin
  ) {}

  async handle(
    context: IExecutionContext,
    command: DiscardComputedOutboxAnomalyBatchCommand
  ): Promise<Result<DiscardComputedOutboxAnomalyBatchCommandResult, DomainError>> {
    const result = await this.admin.discardAnomalyBatch(context, {
      targetId: command.targetId,
      baseId: command.baseId,
      seedTableId: command.seedTableId,
      errorSignature: command.errorSignature,
    });
    return result.map(DiscardComputedOutboxAnomalyBatchCommandResult.create);
  }
}
