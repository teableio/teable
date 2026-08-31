import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { ComputedOutboxPauseScope } from '../../domain/computed/outbox';
import type { DomainError } from '../../domain/shared/DomainError';
import { IComputedOutboxAdmin } from '../../ports/ComputedOutboxAdmin';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { CommandHandler, type ICommandHandler } from '../CommandHandler';
import { PauseComputedOutboxCommand } from './PauseComputedOutboxCommand';

export class PauseComputedOutboxResult {
  private constructor(readonly scope: ComputedOutboxPauseScope) {}

  static create(scope: ComputedOutboxPauseScope): PauseComputedOutboxResult {
    return new PauseComputedOutboxResult(scope);
  }
}

@CommandHandler(PauseComputedOutboxCommand)
@injectable()
export class PauseComputedOutboxHandler
  implements ICommandHandler<PauseComputedOutboxCommand, PauseComputedOutboxResult>
{
  constructor(
    @inject(v2CoreTokens.computedOutboxAdmin)
    private readonly admin: IComputedOutboxAdmin
  ) {}

  async handle(
    context: IExecutionContext,
    command: PauseComputedOutboxCommand
  ): Promise<Result<PauseComputedOutboxResult, DomainError>> {
    const result = await this.admin.pauseSpace(context, {
      spaceId: command.spaceId,
      reason: command.reason,
      durationMinutes: command.durationMinutes,
      actor: context.actorId.toString(),
    });
    return result.map(PauseComputedOutboxResult.create);
  }
}
