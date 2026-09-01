import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { ComputedOutboxClaimConcurrency } from '../../domain/computed/outbox';
import type { DomainError } from '../../domain/shared/DomainError';
import { IComputedOutboxAdmin } from '../../ports/ComputedOutboxAdmin';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { CommandHandler, type ICommandHandler } from '../CommandHandler';
import { UpdateComputedOutboxClaimConcurrencyCommand } from './UpdateComputedOutboxClaimConcurrencyCommand';

export class UpdateComputedOutboxClaimConcurrencyResult {
  private constructor(readonly concurrency: ComputedOutboxClaimConcurrency) {}

  static create(
    concurrency: ComputedOutboxClaimConcurrency
  ): UpdateComputedOutboxClaimConcurrencyResult {
    return new UpdateComputedOutboxClaimConcurrencyResult(concurrency);
  }
}

@CommandHandler(UpdateComputedOutboxClaimConcurrencyCommand)
@injectable()
export class UpdateComputedOutboxClaimConcurrencyHandler
  implements
    ICommandHandler<
      UpdateComputedOutboxClaimConcurrencyCommand,
      UpdateComputedOutboxClaimConcurrencyResult
    >
{
  constructor(
    @inject(v2CoreTokens.computedOutboxAdmin)
    private readonly admin: IComputedOutboxAdmin
  ) {}

  async handle(
    context: IExecutionContext,
    command: UpdateComputedOutboxClaimConcurrencyCommand
  ): Promise<Result<UpdateComputedOutboxClaimConcurrencyResult, DomainError>> {
    const result = await this.admin.setClaimConcurrency(context, {
      perBase: command.perBase,
      perSeedTable: command.perSeedTable,
    });
    return result.map(UpdateComputedOutboxClaimConcurrencyResult.create);
  }
}
