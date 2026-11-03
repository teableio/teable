import type { DomainError, IExecutionContext } from '@teable/v2-core';
import type { Result } from 'neverthrow';

import type {
  OperationPreviewPlan,
  PreviewOperation,
  PreviewOptions,
  PreviewOperationRegistration,
} from './types';

/**
 * Host-owned concerns that do not belong in v2-core command preparation.
 *
 * Adapters report every applicable concern as either demonstrated evidence or
 * unknown coverage; callers must not infer a host policy from core metadata.
 */
export const hostPreviewConcernValues = [
  'destination.placement',
  'billing.quota',
  'trash.retention',
  'attachments',
  'workflows',
  'authority',
  'shares',
  'app-runtime.extras',
  'cross-database.copy',
] as const;

export type HostPreviewConcern = (typeof hostPreviewConcernValues)[number];

/** Transport-neutral seam implemented by an application host. */
export interface IHostPreviewAdapter<TInput = unknown> {
  readonly operation: PreviewOperation;
  readonly concerns: ReadonlyArray<HostPreviewConcern>;
  readonly plannerVersion: string;
  readonly executionPath: string;

  /** Must be observational only: no writes, events, hooks, or deferred mutations. */
  preview(
    context: IExecutionContext,
    input: TInput,
    options: PreviewOptions
  ): Promise<Result<OperationPreviewPlan, DomainError>>;
}
export type HostPreviewRegistration<TInput = unknown> = PreviewOperationRegistration<TInput> & {
  readonly planner: IHostPreviewAdapter<TInput>;
  /** Higher-ranked host editions replace lower-ranked registrations deterministically. */
  readonly priority: number;
};
