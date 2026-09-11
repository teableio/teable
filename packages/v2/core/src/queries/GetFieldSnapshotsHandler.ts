import { inject, injectable } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';

import { isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { Field } from '../domain/table/fields/Field';
import type { FieldId } from '../domain/table/fields/FieldId';
import { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { GetFieldSnapshotsQuery } from './GetFieldSnapshotsQuery';
import { collectHydratedFieldIds } from './ListFieldsHandler';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

export type FieldSnapshotQueryItem = {
  readonly id: string;
  readonly version: number;
  readonly field: Field;
};

export class GetFieldSnapshotsResult {
  private constructor(
    readonly snapshots: ReadonlyArray<FieldSnapshotQueryItem>,
    readonly fields: ReadonlyArray<Field>,
    readonly primaryFieldId?: FieldId
  ) {}

  static create(
    snapshots: ReadonlyArray<FieldSnapshotQueryItem>,
    fields: ReadonlyArray<Field> = [],
    primaryFieldId?: FieldId
  ): GetFieldSnapshotsResult {
    return new GetFieldSnapshotsResult(snapshots, fields, primaryFieldId);
  }
}

@QueryHandler(GetFieldSnapshotsQuery)
@injectable()
export class GetFieldSnapshotsHandler
  implements IQueryHandler<GetFieldSnapshotsQuery, GetFieldSnapshotsResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository
  ) {}

  async handle(
    context: IExecutionContext,
    query: GetFieldSnapshotsQuery
  ): Promise<Result<GetFieldSnapshotsResult, DomainError>> {
    if (query.fieldIds.length === 0) {
      return ok(GetFieldSnapshotsResult.create([]));
    }

    const specResult = Table.specs().byId(query.tableId).withFieldIds(query.fieldIds).build();
    if (specResult.isErr()) return err(specResult.error);

    const tableResult = await this.tableRepository.findOne(context, specResult.value, {
      state: 'activeWithPending',
    });
    if (tableResult.isErr()) {
      if (isNotFoundError(tableResult.error)) {
        return ok(GetFieldSnapshotsResult.create([]));
      }
      return err(tableResult.error);
    }

    const table = tableResult.value;
    const requestedIds = query.fieldIds.map((fieldId) => fieldId.toString());
    const requested = new Set(requestedIds);
    const hydratedFieldIds = collectHydratedFieldIds(table, requested);
    const fields = table.getFields((field) => hydratedFieldIds.has(field.id().toString()));
    const fieldById = new Map(fields.map((field) => [field.id().toString(), field]));
    const seen = new Set<string>();
    const snapshots: FieldSnapshotQueryItem[] = [];
    for (const fieldId of requestedIds) {
      if (seen.has(fieldId)) continue;
      seen.add(fieldId);
      const field = fieldById.get(fieldId);
      if (!field) continue;
      const version = field.version();
      if (version.isErr()) continue;
      snapshots.push({
        id: fieldId,
        version: version.value.toNumber(),
        field,
      });
    }

    return ok(GetFieldSnapshotsResult.create(snapshots, fields, table.primaryFieldId()));
  }
}
