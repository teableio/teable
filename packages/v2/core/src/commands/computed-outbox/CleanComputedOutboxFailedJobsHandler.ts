import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { IComputedOutboxAdmin } from '../../ports/ComputedOutboxAdmin';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { CommandHandler, type ICommandHandler } from '../CommandHandler';
import { CleanComputedOutboxFailedJobsCommand } from './CleanComputedOutboxFailedJobsCommand';

export class CleanComputedOutboxFailedJobsResult {
  private constructor(readonly cleaned: number) {}

  static create(cleaned: number): CleanComputedOutboxFailedJobsResult {
    return new CleanComputedOutboxFailedJobsResult(cleaned);
  }
}

@CommandHandler(CleanComputedOutboxFailedJobsCommand)
@injectable()
export class CleanComputedOutboxFailedJobsHandler
  implements
    ICommandHandler<CleanComputedOutboxFailedJobsCommand, CleanComputedOutboxFailedJobsResult>
{
  constructor(
    @inject(v2CoreTokens.computedOutboxAdmin)
    private readonly admin: IComputedOutboxAdmin
  ) {}

  async handle(
    context: IExecutionContext,
    _command: CleanComputedOutboxFailedJobsCommand
  ): Promise<Result<CleanComputedOutboxFailedJobsResult, DomainError>> {
    const result = await this.admin.cleanFailedJobs(context);
    return result.map((value) => CleanComputedOutboxFailedJobsResult.create(value.cleaned));
  }
}
