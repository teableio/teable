import type { Result } from 'neverthrow';

import type { BaseId } from '../domain/base/BaseId';
import type { DomainError } from '../domain/shared/DomainError';
import type { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import type { IExecutionContext } from './ExecutionContext';

export type CollaboratorDirectoryUser = {
  readonly id: string;
  readonly name: string;
  readonly avatar?: string | null;
};

export interface ICollaboratorDirectoryService {
  listBaseUsers(
    context: IExecutionContext,
    baseId: BaseId,
    options: {
      readonly pagination: OffsetPagination;
      readonly search?: string;
    }
  ): Promise<Result<ReadonlyArray<CollaboratorDirectoryUser>, DomainError>>;

  listUsersByIds(
    context: IExecutionContext,
    userIds: ReadonlyArray<string>,
    options: {
      readonly pagination: OffsetPagination;
      readonly search?: string;
    }
  ): Promise<Result<ReadonlyArray<CollaboratorDirectoryUser>, DomainError>>;
}
