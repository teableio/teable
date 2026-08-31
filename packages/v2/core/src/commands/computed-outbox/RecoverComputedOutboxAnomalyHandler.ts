import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { RecoverComputedOutboxAnomalyResult } from '../../domain/computed/outbox';
import type { DomainError } from '../../domain/shared/DomainError';
import { IComputedOutboxAdmin } from '../../ports/ComputedOutboxAdmin';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { CommandHandler, type ICommandHandler } from '../CommandHandler';
import { RecoverComputedOutboxAnomalyCommand } from './RecoverComputedOutboxAnomalyCommand';

export class RecoverComputedOutboxAnomalyCommandResult {
  private constructor(readonly recovery: RecoverComputedOutboxAnomalyResult) {}

  static create(
    recovery: RecoverComputedOutboxAnomalyResult
  ): RecoverComputedOutboxAnomalyCommandResult {
    return new RecoverComputedOutboxAnomalyCommandResult(recovery);
  }
}

@CommandHandler(RecoverComputedOutboxAnomalyCommand)
@injectable()
export class RecoverComputedOutboxAnomalyHandler
  implements
    ICommandHandler<RecoverComputedOutboxAnomalyCommand, RecoverComputedOutboxAnomalyCommandResult>
{
  constructor(
    @inject(v2CoreTokens.computedOutboxAdmin)
    private readonly admin: IComputedOutboxAdmin
  ) {}

  async handle(
    context: IExecutionContext,
    command: RecoverComputedOutboxAnomalyCommand
  ): Promise<Result<RecoverComputedOutboxAnomalyCommandResult, DomainError>> {
    const result = await this.admin.recoverAnomaly(context, {
      targetId: command.targetId,
      taskId: command.taskId,
      kind: command.kind,
    });
    return result.map(RecoverComputedOutboxAnomalyCommandResult.create);
  }
}
