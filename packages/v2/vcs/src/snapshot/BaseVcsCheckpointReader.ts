import {
  RecordByIdsSpec,
  RecordId,
  Table,
  TableId,
  type BaseId,
  type DomainError,
  type IBaseRepository,
  type IExecutionContext,
  type ITableRecordQueryRepository,
  type ITableRepository,
} from '@teable/v2-core';
import { err, ok, Result } from 'neverthrow';

import { vcsDomainError } from '../domain/errors';
import type { IBaseVcsSnapshot, IRecordVcsSnapshot, ITableVcsSnapshot } from '../domain/types';
import type { SelectCheckpointRecords } from '../ports/server';
import {
  mapRecordReadModelToVcsSnapshot,
  mapTableFieldsToVcsSnapshots,
  mapTableViewsFromDomain,
} from './tableToVcsSnapshot';

/** Storage-only capture. Query-bus results may be redacted by the current actor's plugins. */
export class BaseVcsCheckpointReader {
  constructor(
    private readonly bases: IBaseRepository,
    private readonly tables: ITableRepository,
    private readonly records: ITableRecordQueryRepository
  ) {}

  readonly capture = Object.assign(
    (
      ctx: IExecutionContext,
      baseId: BaseId,
      revision: number,
      deletedTableIds?: readonly string[]
    ) => this.read(ctx, baseId, revision, deletedTableIds),
    {
      withRecordSelection: (
        ctx: IExecutionContext,
        baseId: BaseId,
        revision: number,
        select: SelectCheckpointRecords
      ) => this.read(ctx, baseId, revision, undefined, select),
    }
  );

  private async read(
    ctx: IExecutionContext,
    baseId: BaseId,
    revision: number,
    deletedTableIds?: readonly string[],
    select?: SelectCheckpointRecords
  ): Promise<Result<IBaseVcsSnapshot, DomainError>> {
    const base = await this.bases.findOne(ctx, baseId);
    if (base.isErr()) return err(base.error);
    if (!base.value) {
      return err(
        vcsDomainError.notFound({ code: 'vcs.base_not_found', message: 'Base no longer exists' })
      );
    }
    const builder = Table.specs(baseId);
    if (deletedTableIds) {
      const ids = Result.combine(deletedTableIds.map((id) => TableId.create(id)));
      if (ids.isErr()) return err(ids.error);
      builder.byIds(ids.value);
    }
    const spec = builder.build();
    if (spec.isErr()) return err(spec.error);
    const listed = await this.tables.find(ctx, spec.value, {
      state: deletedTableIds ? 'deleted' : 'active',
    });
    if (listed.isErr()) return err(listed.error);

    const tables: ITableVcsSnapshot[] = [];
    for (const table of listed.value) {
      const fields = mapTableFieldsToVcsSnapshots(table);
      if (fields.isErr()) return err(fields.error);
      const views = mapTableViewsFromDomain(table);
      if (views.isErr()) return err(views.error);
      const dbName = table.dbTableName().andThen((name) => name.value());
      if (dbName.isErr()) return err(dbName.error);
      const schema = {
        id: table.id().toString(),
        name: table.name().toString(),
        dbTableName: dbName.value,
        primaryFieldId: table.primaryFieldId().toString(),
        fields: fields.value,
        views: views.value,
      };
      let selected: readonly string[] | undefined;
      if (select) {
        let columns: Record<string, string> | undefined = {};
        for (const field of table.getFields()) {
          // An errored formula reads as NULL even if its physical value and xmin are unchanged.
          if (field.hasError().isError()) {
            columns = undefined;
            break;
          }
          const column = field.dbFieldName().andThen((name) => name.value());
          if (column.isErr()) {
            columns = undefined;
            break;
          }
          columns[field.id().toString()] = column.value;
        }
        if (columns) selected = await select(schema, columns);
      }
      const records: IRecordVcsSnapshot[] = [];
      if (selected === undefined || selected.length) {
        const ids = Result.combine((selected ?? []).map((id) => RecordId.create(id)));
        if (ids.isErr()) return err(ids.error);
        const filter = selected ? RecordByIdsSpec.create(ids.value) : undefined;
        for await (const record of this.records.findStream(ctx, table, filter, {
          mode: 'stored',
          includeOrders: true,
        })) {
          if (record.isErr()) return err(record.error);
          records.push(mapRecordReadModelToVcsSnapshot(record.value));
        }
      }
      tables.push({ ...schema, records });
    }
    return ok({
      formatVersion: 1,
      baseId: baseId.toString(),
      baseName: base.value.name().toString(),
      revision,
      capturedAt: new Date().toISOString(),
      tables,
    });
  }
}
