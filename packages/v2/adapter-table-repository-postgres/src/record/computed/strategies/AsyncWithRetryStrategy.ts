import { domainError, type DomainError, type IExecutionContext } from '@teable/v2-core';
import { injectable } from '@teable/v2-di';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ComputedFieldUpdater, ComputedUpdateResult } from '../ComputedFieldUpdater';
import type { ComputedUpdatePlan } from '../ComputedUpdatePlanner';
import type { IUpdateStrategy, UpdateStrategyMode } from './IUpdateStrategy';

/**
 * Async strategy placeholder.
 *
 * Intended behavior (future):
 * - enqueue plan into an event-driven worker
 * - persist failures + retry metadata
 */
@injectable()
export class AsyncWithRetryStrategy implements IUpdateStrategy {
  readonly name = 'async';
  readonly mode: UpdateStrategyMode = 'async';

  async execute(
    _updater: ComputedFieldUpdater,
    _plan: ComputedUpdatePlan,
    _context: IExecutionContext
  ): Promise<Result<ComputedUpdateResult | undefined, DomainError>> {
    return err(
      domainError.unexpected({
        message: 'Async computed update strategy is not wired yet; use SyncInTransactionStrategy.',
      })
    );
  }

  scheduleDispatch(_context: IExecutionContext): void {
    // No-op: This strategy is not implemented yet
  }
}
