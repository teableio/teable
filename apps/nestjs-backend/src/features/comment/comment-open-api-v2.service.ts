import { Injectable } from '@nestjs/common';
import type { ICommentCountVo } from '@teable/openapi';
import { GetTableCommentCountQuery, v2CoreTokens } from '@teable/v2-core';
import type { GetTableCommentCountResult, IQueryBus } from '@teable/v2-core';

import { throwV2QueryDomainError } from '../aggregation/open-api/aggregation-v2-result.mapper';
import { V2ContainerService } from '../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../v2/v2-execution-context.factory';

@Injectable()
export class CommentOpenApiV2Service {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory
  ) {}

  async getTableCommentCount(tableId: string, recordIds: string[]): Promise<ICommentCountVo> {
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const context = await this.v2ContextFactory.createContext(container);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const queryResult = GetTableCommentCountQuery.create({ tableId, recordIds });
    if (queryResult.isErr()) {
      throwV2QueryDomainError(queryResult.error);
    }
    const result = await queryBus.execute<GetTableCommentCountQuery, GetTableCommentCountResult>(
      context,
      queryResult.value
    );
    if (result.isErr()) {
      throwV2QueryDomainError(result.error);
    }
    return [...result.value.counts];
  }
}
