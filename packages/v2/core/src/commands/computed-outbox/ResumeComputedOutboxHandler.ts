import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { ResumeComputedOutboxScopeResult } from '../../domain/computed/outbox';
import type { DomainError } from '../../domain/shared/DomainError';
import { IComputedOutboxAdmin } from '../../ports/ComputedOutboxAdmin';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { CommandHandler, type ICommandHandler } from '../CommandHandler';
import { ResumeComputedOutboxCommand } from './ResumeComputedOutboxCommand';

export class ResumeComputedOutboxResult {
  private constructor(readonly resume: ResumeComputedOutboxScopeResult) {}

  static create(resume: ResumeComputedOutboxScopeResult): ResumeComputedOutboxResult {
    return new ResumeComputedOutboxResult(resume);
  }
}

@CommandHandler(ResumeComputedOutboxCommand)
@injectable()
export class ResumeComputedOutboxHandler
  implements ICommandHandler<ResumeComputedOutboxCommand, ResumeComputedOutboxResult>
{
  constructor(
    @inject(v2CoreTokens.computedOutboxAdmin)
    private readonly admin: IComputedOutboxAdmin
  ) {}

  async handle(
    context: IExecutionContext,
    command: ResumeComputedOutboxCommand
  ): Promise<Result<ResumeComputedOutboxResult, DomainError>> {
    const result = await this.admin.resumeScope(context, {
      targetId: command.targetId,
      scopeType: command.scopeType,
      scopeId: command.scopeId,
    });
    return result.map(ResumeComputedOutboxResult.create);
  }
}
