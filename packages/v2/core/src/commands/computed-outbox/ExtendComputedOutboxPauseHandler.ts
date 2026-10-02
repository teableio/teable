import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { ComputedOutboxPauseScope } from '../../domain/computed/outbox';
import type { DomainError } from '../../domain/shared/DomainError';
import { IComputedOutboxAdmin } from '../../ports/ComputedOutboxAdmin';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { CommandHandler, type ICommandHandler } from '../CommandHandler';
import { ExtendComputedOutboxPauseCommand } from './ExtendComputedOutboxPauseCommand';

export class ExtendComputedOutboxPauseResult {
  private constructor(readonly scope: ComputedOutboxPauseScope) {}

  static create(scope: ComputedOutboxPauseScope): ExtendComputedOutboxPauseResult {
    return new ExtendComputedOutboxPauseResult(scope);
  }
}

@CommandHandler(ExtendComputedOutboxPauseCommand)
@injectable()
export class ExtendComputedOutboxPauseHandler
  implements ICommandHandler<ExtendComputedOutboxPauseCommand, ExtendComputedOutboxPauseResult>
{
  constructor(
    @inject(v2CoreTokens.computedOutboxAdmin)
    private readonly admin: IComputedOutboxAdmin
  ) {}

  async handle(
    context: IExecutionContext,
    command: ExtendComputedOutboxPauseCommand
  ): Promise<Result<ExtendComputedOutboxPauseResult, DomainError>> {
    const result = await this.admin.extendPause(context, {
      targetId: command.targetId,
      leaseId: command.leaseId,
      durationMinutes: command.durationMinutes,
      actor: context.actorId.toString(),
    });
    return result.map(ExtendComputedOutboxPauseResult.create);
  }
}
