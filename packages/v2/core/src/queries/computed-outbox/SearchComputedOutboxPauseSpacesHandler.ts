import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { ComputedOutboxPauseSpace } from '../../domain/computed/outbox';
import type { DomainError } from '../../domain/shared/DomainError';
import { IComputedOutboxAdmin } from '../../ports/ComputedOutboxAdmin';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { QueryHandler, type IQueryHandler } from '../QueryHandler';
import { SearchComputedOutboxPauseSpacesQuery } from './SearchComputedOutboxPauseSpacesQuery';

export class SearchComputedOutboxPauseSpacesResult {
  private constructor(readonly spaces: ReadonlyArray<ComputedOutboxPauseSpace>) {}

  static create(
    spaces: ReadonlyArray<ComputedOutboxPauseSpace>
  ): SearchComputedOutboxPauseSpacesResult {
    return new SearchComputedOutboxPauseSpacesResult(spaces);
  }
}

@QueryHandler(SearchComputedOutboxPauseSpacesQuery)
@injectable()
export class SearchComputedOutboxPauseSpacesHandler
  implements
    IQueryHandler<SearchComputedOutboxPauseSpacesQuery, SearchComputedOutboxPauseSpacesResult>
{
  constructor(
    @inject(v2CoreTokens.computedOutboxAdmin)
    private readonly admin: IComputedOutboxAdmin
  ) {}

  async handle(
    context: IExecutionContext,
    query: SearchComputedOutboxPauseSpacesQuery
  ): Promise<Result<SearchComputedOutboxPauseSpacesResult, DomainError>> {
    const result = await this.admin.searchPauseSpaces(context, {
      search: query.search,
      limit: query.limit,
    });
    return result.map((value) => SearchComputedOutboxPauseSpacesResult.create(value.spaces));
  }
}
