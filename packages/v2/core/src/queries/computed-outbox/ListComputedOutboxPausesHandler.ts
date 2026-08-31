import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { ComputedOutboxPauseList } from '../../domain/computed/outbox';
import type { DomainError } from '../../domain/shared/DomainError';
import { IComputedOutboxAdmin } from '../../ports/ComputedOutboxAdmin';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { QueryHandler, type IQueryHandler } from '../QueryHandler';
import { ListComputedOutboxPausesQuery } from './ListComputedOutboxPausesQuery';

export class ListComputedOutboxPausesResult {
  private constructor(readonly list: ComputedOutboxPauseList) {}

  static create(list: ComputedOutboxPauseList): ListComputedOutboxPausesResult {
    return new ListComputedOutboxPausesResult(list);
  }
}

@QueryHandler(ListComputedOutboxPausesQuery)
@injectable()
export class ListComputedOutboxPausesHandler
  implements IQueryHandler<ListComputedOutboxPausesQuery, ListComputedOutboxPausesResult>
{
  constructor(
    @inject(v2CoreTokens.computedOutboxAdmin)
    private readonly admin: IComputedOutboxAdmin
  ) {}

  async handle(
    context: IExecutionContext,
    _query: ListComputedOutboxPausesQuery
  ): Promise<Result<ListComputedOutboxPausesResult, DomainError>> {
    const result = await this.admin.listPauses(context);
    return result.map(ListComputedOutboxPausesResult.create);
  }
}
