import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { ComputedOutboxOverview } from '../../domain/computed/outbox';
import type { DomainError } from '../../domain/shared/DomainError';
import { IComputedOutboxAdmin } from '../../ports/ComputedOutboxAdmin';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { QueryHandler, type IQueryHandler } from '../QueryHandler';
import { GetComputedOutboxOverviewQuery } from './GetComputedOutboxOverviewQuery';

export class GetComputedOutboxOverviewResult {
  private constructor(readonly overview: ComputedOutboxOverview) {}

  static create(overview: ComputedOutboxOverview): GetComputedOutboxOverviewResult {
    return new GetComputedOutboxOverviewResult(overview);
  }
}

@QueryHandler(GetComputedOutboxOverviewQuery)
@injectable()
export class GetComputedOutboxOverviewHandler
  implements IQueryHandler<GetComputedOutboxOverviewQuery, GetComputedOutboxOverviewResult>
{
  constructor(
    @inject(v2CoreTokens.computedOutboxAdmin)
    private readonly admin: IComputedOutboxAdmin
  ) {}

  async handle(
    context: IExecutionContext,
    query: GetComputedOutboxOverviewQuery
  ): Promise<Result<GetComputedOutboxOverviewResult, DomainError>> {
    const result = await this.admin.getOverview(context, { force: query.force });
    return result.map(GetComputedOutboxOverviewResult.create);
  }
}
