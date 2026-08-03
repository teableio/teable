import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { UserId } from '../domain/table/fields/types/UserId';
import type { IExecutionContext } from './ExecutionContext';

export type UserRenamePropagationInput = {
  userId: UserId;
  name: string;
};

export interface IUserRenamePropagationService {
  propagateUserRename(
    context: IExecutionContext,
    input: UserRenamePropagationInput
  ): Promise<Result<void, DomainError>>;
}
