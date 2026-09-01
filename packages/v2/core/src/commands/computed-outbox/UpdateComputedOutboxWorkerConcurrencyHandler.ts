import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { ComputedOutboxWorkerConcurrency } from '../../domain/computed/outbox';
import type { DomainError } from '../../domain/shared/DomainError';
import { IComputedOutboxAdmin } from '../../ports/ComputedOutboxAdmin';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { CommandHandler, type ICommandHandler } from '../CommandHandler';
import { UpdateComputedOutboxWorkerConcurrencyCommand } from './UpdateComputedOutboxWorkerConcurrencyCommand';

export class UpdateComputedOutboxWorkerConcurrencyResult {
  private constructor(readonly concurrency: ComputedOutboxWorkerConcurrency) {}

  static create(
    concurrency: ComputedOutboxWorkerConcurrency
  ): UpdateComputedOutboxWorkerConcurrencyResult {
    return new UpdateComputedOutboxWorkerConcurrencyResult(concurrency);
  }
}

@CommandHandler(UpdateComputedOutboxWorkerConcurrencyCommand)
@injectable()
export class UpdateComputedOutboxWorkerConcurrencyHandler
  implements
    ICommandHandler<
      UpdateComputedOutboxWorkerConcurrencyCommand,
      UpdateComputedOutboxWorkerConcurrencyResult
    >
{
  constructor(
    @inject(v2CoreTokens.computedOutboxAdmin)
    private readonly admin: IComputedOutboxAdmin
  ) {}

  async handle(
    context: IExecutionContext,
    command: UpdateComputedOutboxWorkerConcurrencyCommand
  ): Promise<Result<UpdateComputedOutboxWorkerConcurrencyResult, DomainError>> {
    const result = await this.admin.setWorkerConcurrency(context, command.concurrency);
    return result.map(UpdateComputedOutboxWorkerConcurrencyResult.create);
  }
}
