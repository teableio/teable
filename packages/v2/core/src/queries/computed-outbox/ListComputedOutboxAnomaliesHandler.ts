import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { ComputedOutboxAnomalyList } from '../../domain/computed/outbox';
import type { DomainError } from '../../domain/shared/DomainError';
import { IComputedOutboxAdmin } from '../../ports/ComputedOutboxAdmin';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { QueryHandler, type IQueryHandler } from '../QueryHandler';
import { ListComputedOutboxAnomaliesQuery } from './ListComputedOutboxAnomaliesQuery';

export class ListComputedOutboxAnomaliesResult {
  private constructor(readonly list: ComputedOutboxAnomalyList) {}

  static create(list: ComputedOutboxAnomalyList): ListComputedOutboxAnomaliesResult {
    return new ListComputedOutboxAnomaliesResult(list);
  }
}

@QueryHandler(ListComputedOutboxAnomaliesQuery)
@injectable()
export class ListComputedOutboxAnomaliesHandler
  implements IQueryHandler<ListComputedOutboxAnomaliesQuery, ListComputedOutboxAnomaliesResult>
{
  constructor(
    @inject(v2CoreTokens.computedOutboxAdmin)
    private readonly admin: IComputedOutboxAdmin
  ) {}

  async handle(
    context: IExecutionContext,
    query: ListComputedOutboxAnomaliesQuery
  ): Promise<Result<ListComputedOutboxAnomaliesResult, DomainError>> {
    const result = await this.admin.listAnomalies(context, {
      limit: query.limit,
      q: query.q,
      kind: query.kind,
    });
    return result.map(ListComputedOutboxAnomaliesResult.create);
  }
}
