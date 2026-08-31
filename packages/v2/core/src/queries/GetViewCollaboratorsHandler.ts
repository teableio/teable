import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { RecordConditionSpecBuilder } from '../domain/table/records/specs/RecordConditionSpecBuilder';
import { Table } from '../domain/table/Table';
import { ICollaboratorDirectoryService } from '../ports/CollaboratorDirectoryService';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { ITableRecordCollaboratorQueryRepository } from '../ports/TableRecordQueryRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { GetViewCollaboratorsQuery } from './GetViewCollaboratorsQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';
import {
  buildRecordConditionSpec,
  replaceCurrentUserTagInFilter,
  sanitizeRecordFilter,
} from './RecordFilterMapper';

export type ViewCollaborator = {
  readonly userId: string;
  readonly userName: string;
  readonly avatar?: string | null;
};

export class GetViewCollaboratorsResult {
  private constructor(readonly collaborators: ReadonlyArray<ViewCollaborator>) {}

  static create(collaborators: ReadonlyArray<ViewCollaborator>): GetViewCollaboratorsResult {
    return new GetViewCollaboratorsResult(collaborators);
  }
}

@QueryHandler(GetViewCollaboratorsQuery)
@injectable()
export class GetViewCollaboratorsHandler
  implements IQueryHandler<GetViewCollaboratorsQuery, GetViewCollaboratorsResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: ITableRecordCollaboratorQueryRepository,
    @inject(v2CoreTokens.collaboratorDirectoryService)
    private readonly collaboratorDirectoryService: ICollaboratorDirectoryService
  ) {}

  async handle(
    context: IExecutionContext,
    query: GetViewCollaboratorsQuery
  ): Promise<Result<GetViewCollaboratorsResult, DomainError>> {
    return safeTry<GetViewCollaboratorsResult, DomainError>(
      async function* (this: GetViewCollaboratorsHandler) {
        const specBuilder = Table.specs().byId(query.tableId);
        if (query.viewId) specBuilder.withViewId(query.viewId);
        const tableSpec = yield* specBuilder.build();
        const table = yield* (await this.tableRepository.findOne(context, tableSpec)).mapErr(
          (error) =>
            isNotFoundError(error) && query.viewId
              ? domainError.notFound({
                  code: 'view.not_found',
                  message: `View not found: ${query.viewId.toString()}`,
                })
              : error
        );
        const plan = yield* table.createViewCollaboratorsQueryPlan({
          viewId: query.viewId,
          fieldId: query.fieldId,
          includeHiddenFields: query.includeHiddenFields,
          canReadAllCollaborators: query.canReadAllCollaborators,
        });

        if (plan.mode === 'empty') return ok(GetViewCollaboratorsResult.create([]));

        if (plan.mode === 'all') {
          const users = yield* await this.collaboratorDirectoryService.listBaseUsers(
            context,
            table.baseId(),
            { pagination: query.pagination, search: query.search }
          );
          return ok(GetViewCollaboratorsResult.create(users.map(GetViewCollaboratorsHandler.map)));
        }

        const field = yield* plan.referencedField();
        let conditionSpec;
        const rawFilter = replaceCurrentUserTagInFilter(
          table,
          plan.recordFilter(),
          context.actorId.toString()
        );
        const sanitizedFilter = yield* sanitizeRecordFilter(table, rawFilter);
        if (sanitizedFilter) {
          const builder = RecordConditionSpecBuilder.create();
          builder.addConditionSpec(yield* buildRecordConditionSpec(table, sanitizedFilter));
          conditionSpec = yield* builder.build();
        }
        const userIds = yield* await this.tableRecordQueryRepository.findDistinctUserIds(
          context,
          table,
          field,
          conditionSpec
        );
        if (!userIds.length) return ok(GetViewCollaboratorsResult.create([]));
        const users = yield* await this.collaboratorDirectoryService.listUsersByIds(
          context,
          userIds,
          { pagination: query.pagination, search: query.search }
        );
        return ok(GetViewCollaboratorsResult.create(users.map(GetViewCollaboratorsHandler.map)));
      }.bind(this)
    );
  }

  private static map(user: {
    readonly id: string;
    readonly name: string;
    readonly avatar?: string | null;
  }): ViewCollaborator {
    return {
      userId: user.id,
      userName: user.name,
      ...(user.avatar !== undefined ? { avatar: user.avatar } : {}),
    };
  }
}
