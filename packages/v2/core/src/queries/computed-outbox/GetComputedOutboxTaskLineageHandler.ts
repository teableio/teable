import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { ComputedOutboxTaskLineage } from '../../domain/computed/outbox';
import type { DomainError } from '../../domain/shared/DomainError';
import { IComputedOutboxAdmin } from '../../ports/ComputedOutboxAdmin';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { QueryHandler, type IQueryHandler } from '../QueryHandler';
import { GetComputedOutboxTaskLineageQuery } from './GetComputedOutboxTaskLineageQuery';

export class GetComputedOutboxTaskLineageResult {
  private constructor(readonly lineage: ComputedOutboxTaskLineage) {}

  static create(lineage: ComputedOutboxTaskLineage): GetComputedOutboxTaskLineageResult {
    return new GetComputedOutboxTaskLineageResult(lineage);
  }
}

@QueryHandler(GetComputedOutboxTaskLineageQuery)
@injectable()
export class GetComputedOutboxTaskLineageHandler
  implements IQueryHandler<GetComputedOutboxTaskLineageQuery, GetComputedOutboxTaskLineageResult>
{
  constructor(
    @inject(v2CoreTokens.computedOutboxAdmin)
    private readonly admin: IComputedOutboxAdmin
  ) {}

  async handle(
    context: IExecutionContext,
    query: GetComputedOutboxTaskLineageQuery
  ): Promise<Result<GetComputedOutboxTaskLineageResult, DomainError>> {
    const result = await this.admin.getTaskLineage(context, { taskId: query.taskId });
    return result.map(GetComputedOutboxTaskLineageResult.create);
  }
}
