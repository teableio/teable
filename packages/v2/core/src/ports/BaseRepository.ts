import type { Result } from 'neverthrow';

import type { Base } from '../domain/base/Base';
import type { BaseId } from '../domain/base/BaseId';
import type { DomainError } from '../domain/shared/DomainError';
import type { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import type { IExecutionContext } from './ExecutionContext';

export interface IFindBasesResult {
  bases: ReadonlyArray<Base>;
  total: number;
}

export interface IBaseRepository {
  insert(context: IExecutionContext, base: Base): Promise<Result<Base, DomainError>>;
  findOne(context: IExecutionContext, baseId: BaseId): Promise<Result<Base | null, DomainError>>;
  find(
    context: IExecutionContext,
    pagination: OffsetPagination
  ): Promise<Result<IFindBasesResult, DomainError>>;
}
