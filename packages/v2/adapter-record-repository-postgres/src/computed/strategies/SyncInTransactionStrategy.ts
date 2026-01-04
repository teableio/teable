import type { DomainError, IExecutionContext } from '@teable/v2-core';
import { injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { ComputedFieldUpdater } from '../ComputedFieldUpdater';
import type { ComputedUpdatePlan } from '../ComputedUpdatePlanner';
import type { IUpdateStrategy } from './IUpdateStrategy';

/**
 * Synchronous strategy: execute computed updates in the current transaction.
 */
@injectable()
export class SyncInTransactionStrategy implements IUpdateStrategy {
  readonly name = 'sync';

  execute(
    updater: ComputedFieldUpdater,
    plan: ComputedUpdatePlan,
    context: IExecutionContext
  ): Promise<Result<void, DomainError>> {
    return updater.execute(plan, context);
  }
}
