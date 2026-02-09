import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { Base } from '../domain/base/Base';
import type { DomainError } from '../domain/shared/DomainError';
import * as BaseRepositoryPort from '../ports/BaseRepository';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { v2CoreTokens } from '../ports/tokens';
import { ListBasesQuery } from './ListBasesQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

export class ListBasesResult {
  private constructor(
    readonly bases: ReadonlyArray<Base>,
    readonly total: number,
    readonly limit: number,
    readonly offset: number
  ) {}

  static create(
    bases: ReadonlyArray<Base>,
    total: number,
    limit: number,
    offset: number
  ): ListBasesResult {
    return new ListBasesResult(bases, total, limit, offset);
  }
}

@QueryHandler(ListBasesQuery)
@injectable()
export class ListBasesHandler implements IQueryHandler<ListBasesQuery, ListBasesResult> {
  constructor(
    @inject(v2CoreTokens.baseRepository)
    private readonly baseRepository: BaseRepositoryPort.IBaseRepository
  ) {}

  async handle(
    context: IExecutionContext,
    query: ListBasesQuery
  ): Promise<Result<ListBasesResult, DomainError>> {
    const handler = this;
    return safeTry<ListBasesResult, DomainError>(async function* () {
      const result = yield* await handler.baseRepository.find(context, query.pagination);
      return ok(
        ListBasesResult.create(
          result.bases,
          result.total,
          query.pagination.limit().toNumber(),
          query.pagination.offset().toNumber()
        )
      );
    });
  }
}
