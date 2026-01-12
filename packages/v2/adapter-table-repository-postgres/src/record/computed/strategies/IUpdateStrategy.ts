import type { DomainError, IExecutionContext } from '@teable/v2-core';
import type { Result } from 'neverthrow';

import type { ComputedFieldUpdater } from '../ComputedFieldUpdater';
import type { ComputedUpdatePlan } from '../ComputedUpdatePlanner';

/**
 * Strategy interface for executing computed update plans.
 *
 * Example
 * ```typescript
 * const result = await strategy.execute(updater, plan, context);
 * ```
 */
export interface IUpdateStrategy {
  readonly name: string;
  execute(
    updater: ComputedFieldUpdater,
    plan: ComputedUpdatePlan,
    context: IExecutionContext
  ): Promise<Result<void, DomainError>>;

  /**
   * Schedule dispatch to process outbox tasks.
   * Called after enqueueing seed tasks to trigger async processing.
   */
  scheduleDispatch(context: IExecutionContext): void;
}
