import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { RecoverComputedOutboxAnomalyBatchResult } from '../../domain/computed/outbox';
import type { DomainError } from '../../domain/shared/DomainError';
import { IComputedOutboxAdmin } from '../../ports/ComputedOutboxAdmin';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { CommandHandler, type ICommandHandler } from '../CommandHandler';
import { RecoverComputedOutboxAnomalyBatchCommand } from './RecoverComputedOutboxAnomalyBatchCommand';

export class RecoverComputedOutboxAnomalyBatchCommandResult {
  private constructor(readonly recovery: RecoverComputedOutboxAnomalyBatchResult) {}

  static create(
    recovery: RecoverComputedOutboxAnomalyBatchResult
  ): RecoverComputedOutboxAnomalyBatchCommandResult {
    return new RecoverComputedOutboxAnomalyBatchCommandResult(recovery);
  }
}

@CommandHandler(RecoverComputedOutboxAnomalyBatchCommand)
@injectable()
export class RecoverComputedOutboxAnomalyBatchHandler
  implements
    ICommandHandler<
      RecoverComputedOutboxAnomalyBatchCommand,
      RecoverComputedOutboxAnomalyBatchCommandResult
    >
{
  constructor(
    @inject(v2CoreTokens.computedOutboxAdmin)
    private readonly admin: IComputedOutboxAdmin
  ) {}

  async handle(
    context: IExecutionContext,
    command: RecoverComputedOutboxAnomalyBatchCommand
  ): Promise<Result<RecoverComputedOutboxAnomalyBatchCommandResult, DomainError>> {
    const result = await this.admin.recoverAnomalyBatch(context, {
      targetId: command.targetId,
      baseId: command.baseId,
      seedTableId: command.seedTableId,
      errorSignature: command.errorSignature,
    });
    return result.map(RecoverComputedOutboxAnomalyBatchCommandResult.create);
  }
}
