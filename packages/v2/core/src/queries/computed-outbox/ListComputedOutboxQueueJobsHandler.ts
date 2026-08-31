import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import {
  computedOutboxQueueJobStates,
  projectComputedOutboxQueueJobs,
  type ComputedOutboxQueueJobList,
} from '../../domain/computed/outbox';
import type { DomainError } from '../../domain/shared/DomainError';
import { IComputedOutboxAdmin } from '../../ports/ComputedOutboxAdmin';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { QueryHandler, type IQueryHandler } from '../QueryHandler';
import { ListComputedOutboxQueueJobsQuery } from './ListComputedOutboxQueueJobsQuery';

export class ListComputedOutboxQueueJobsResult {
  private constructor(readonly list: ComputedOutboxQueueJobList) {}

  static create(list: ComputedOutboxQueueJobList): ListComputedOutboxQueueJobsResult {
    return new ListComputedOutboxQueueJobsResult(list);
  }
}

@QueryHandler(ListComputedOutboxQueueJobsQuery)
@injectable()
export class ListComputedOutboxQueueJobsHandler
  implements IQueryHandler<ListComputedOutboxQueueJobsQuery, ListComputedOutboxQueueJobsResult>
{
  constructor(
    @inject(v2CoreTokens.computedOutboxAdmin)
    private readonly admin: IComputedOutboxAdmin
  ) {}

  async handle(
    context: IExecutionContext,
    query: ListComputedOutboxQueueJobsQuery
  ): Promise<Result<ListComputedOutboxQueueJobsResult, DomainError>> {
    const states = query.states.length ? query.states : computedOutboxQueueJobStates;
    const scanned = await this.admin.scanQueueJobs(context, states);
    return scanned.map((scan) =>
      ListComputedOutboxQueueJobsResult.create(
        projectComputedOutboxQueueJobs({
          jobs: scan.jobs,
          scan: scan.scan,
          error: scan.error,
          states,
          spaceIds: query.spaceIds,
          baseIds: query.baseIds,
          causes: query.causes,
          outcomes: query.outcomes,
          q: query.q,
          minDurationMs: query.minDurationMs,
          view: query.view,
          includeSettled: query.includeSettled,
          sort: query.sort,
          limit: query.limit,
          offset: query.offset,
        })
      )
    );
  }
}
