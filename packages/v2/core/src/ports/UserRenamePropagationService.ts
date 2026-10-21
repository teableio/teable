import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { UserId } from '../domain/table/fields/types/UserId';
import type { IExecutionContext } from './ExecutionContext';

export type UserRenamePropagationInput = {
  userId: UserId;
  name: string;
  /**
   * Set by callers running against the instance-shared data plane (data db === meta db).
   * That plane only holds orphaned pre-switch copies of bases bound to an external data
   * database: patching those snapshots rewrites rows nobody reads and enqueues computed
   * tasks the claim path fences out, leaving unclaimable ledger rows behind.
   */
  sharedDataPlane?: boolean;
};

export interface IUserRenamePropagationService {
  propagateUserRename(
    context: IExecutionContext,
    input: UserRenamePropagationInput
  ): Promise<Result<void, DomainError>>;
}
