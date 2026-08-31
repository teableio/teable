import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { composeAndSpecsOrUndefined } from '../domain/shared/specification/composeAndSpecs';
import { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { RecordQueryPluginScope } from '../ports/RecordQueryPlugin';
import { ITableRecordCollaboratorQueryRepository } from '../ports/TableRecordQueryRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { IUserLookupService } from '../ports/UserLookupService';
import { GetRecordCollaboratorsQuery } from './GetRecordCollaboratorsQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

export type RecordCollaborator = {
  readonly userId: string;
  readonly userName: string;
  readonly email: string;
  readonly avatar?: string | null;
};

export class GetRecordCollaboratorsResult {
  private constructor(readonly collaborators: ReadonlyArray<RecordCollaborator>) {}

  static create(collaborators: ReadonlyArray<RecordCollaborator>): GetRecordCollaboratorsResult {
    return new GetRecordCollaboratorsResult(collaborators);
  }
}

@QueryHandler(GetRecordCollaboratorsQuery)
@injectable()
export class GetRecordCollaboratorsHandler
  implements IQueryHandler<GetRecordCollaboratorsQuery, GetRecordCollaboratorsResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: ITableRecordCollaboratorQueryRepository,
    @inject(v2CoreTokens.userLookupService)
    private readonly userLookupService: IUserLookupService
  ) {}

  async handle(
    context: IExecutionContext,
    query: GetRecordCollaboratorsQuery
  ): Promise<Result<GetRecordCollaboratorsResult, DomainError>> {
    return safeTry<GetRecordCollaboratorsResult, DomainError>(
      async function* (this: GetRecordCollaboratorsHandler) {
        const tableSpec = yield* Table.specs().byId(query.tableId).build();
        const table = yield* (await this.tableRepository.findOne(context, tableSpec)).mapErr(
          (error) =>
            isNotFoundError(error)
              ? domainError.notFound({
                  code: 'table.not_found',
                  message: 'Table not found',
                  details: { tableId: query.tableId.toString() },
                })
              : error
        );
        const plan = yield* table.createRecordCollaboratorsQueryPlan(query.fieldId);
        const field = yield* plan.referencedField();
        const fieldId = field.id().toString();
        if (
          query.queryScope?.readableFieldIds != null &&
          !query.queryScope.readableFieldIds.has(fieldId)
        ) {
          yield* err(
            domainError.forbidden({
              code: 'record_collaborators.field_forbidden',
              message: 'Collaborator field is not readable',
              details: { fieldId },
            })
          );
        }
        const scopeSpec = composeAndSpecsOrUndefined(
          [
            query.queryScope?.skipRecordSpec ? undefined : query.queryScope?.recordSpec,
            query.queryScope?.fieldMasks?.find((mask) => mask.fieldId === fieldId)?.visibleWhen,
          ].filter(
            (spec): spec is NonNullable<RecordQueryPluginScope['recordSpec']> => spec != null
          )
        );
        const userIds = yield* await this.tableRecordQueryRepository.findDistinctUserIds(
          context,
          table,
          field,
          scopeSpec
        );
        if (!userIds.length) return ok(GetRecordCollaboratorsResult.create([]));

        const users = yield* await this.userLookupService.listUsersByIds(userIds);
        const needle = query.search?.trim().toLowerCase();
        const matched = needle
          ? users.filter(
              (user) =>
                user.name.toLowerCase().includes(needle) ||
                (user.email ?? '').toLowerCase().includes(needle)
            )
          : users;
        const offset = query.pagination.offset().toNumber();
        const limit = query.pagination.limit().toNumber();
        return ok(
          GetRecordCollaboratorsResult.create(
            matched.slice(offset, offset + limit).map((user) => ({
              userId: user.id,
              userName: user.name,
              email: user.email ?? '',
              ...(user.avatarUrl !== undefined ? { avatar: user.avatarUrl } : {}),
            }))
          )
        );
      }.bind(this)
    );
  }
}
