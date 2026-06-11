import type {
  DomainError,
  FieldId,
  IExecutionContext,
  ILogger,
  IUserRenamePropagationService,
  TableId,
  UserRenamePropagationInput,
} from '@teable/v2-core';
import {
  DbTableName,
  FieldId as CoreFieldId,
  TableId as CoreTableId,
  v2CoreTokens,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely, type Transaction } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { resolvePostgresDbOrTx } from '../../shared/db';
import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import { ExternalComputedRefreshService } from './ExternalComputedRefreshService';

type AffectedUserFieldRow = {
  fieldId: string;
  tableId: string;
  dbTableName: string;
  dbFieldName: string;
  isMultipleCellValue: boolean | null;
};

@injectable()
export class UserRenamePropagationService implements IUserRenamePropagationService {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(ExternalComputedRefreshService)
    private readonly externalComputedRefreshService: ExternalComputedRefreshService
  ) {}

  async propagateUserRename(
    context: IExecutionContext,
    input: UserRenamePropagationInput
  ): Promise<Result<void, DomainError>> {
    const db = resolvePostgresDbOrTx(this.db, context);
    const affectedFields = await this.getAffectedUserFields(db, input.userId.toString());
    if (affectedFields.length === 0) return ok(undefined);

    // Rename mutates denormalized user snapshots first, then hands the touched physical fields to
    // the computed refresh closure so lookup/formula/rollup descendants are recomputed from the
    // new source snapshot values instead of from stale cached titles.
    const updatedFields: AffectedUserFieldRow[] = [];
    for (const field of affectedFields) {
      try {
        await this.patchUserSnapshotTitle(db, field, input.userId.toString(), input.name);
        updatedFields.push(field);
      } catch (error: unknown) {
        this.logger.error(error instanceof Error ? error.message : String(error), {
          fieldId: field.fieldId,
          tableId: field.tableId,
        });
      }
    }

    const changesResult = this.toComputedRefreshChanges(updatedFields);
    if (changesResult.isErr()) {
      return err(changesResult.error);
    }

    return this.externalComputedRefreshService.refreshAfterExternalValueChanges(context, {
      changes: changesResult.value,
    });
  }

  private async getAffectedUserFields(
    db: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
    userId: string
  ): Promise<AffectedUserFieldRow[]> {
    const accessibleBaseIds = db
      .selectFrom('collaborator')
      .innerJoin('space', 'collaborator.resource_id', 'space.id')
      .innerJoin('base', 'space.id', 'base.space_id')
      .select('base.id as base_id')
      .where('collaborator.principal_type', '=', 'user')
      .where('collaborator.principal_id', '=', userId)
      .where('space.deleted_time', 'is', null)
      .where('base.deleted_time', 'is', null)
      .union(
        db
          .selectFrom('collaborator')
          .innerJoin('base', 'collaborator.resource_id', 'base.id')
          .innerJoin('space', 'base.space_id', 'space.id')
          .select('base.id as base_id')
          .where('collaborator.principal_type', '=', 'user')
          .where('collaborator.principal_id', '=', userId)
          .where('space.deleted_time', 'is', null)
          .where('base.deleted_time', 'is', null)
      );

    return db
      .with('accessible_base', () => accessibleBaseIds)
      .selectFrom('accessible_base')
      .innerJoin('table_meta', 'accessible_base.base_id', 'table_meta.base_id')
      .innerJoin('field', 'table_meta.id', 'field.table_id')
      .select([
        'field.id as fieldId',
        'field.table_id as tableId',
        'field.db_field_name as dbFieldName',
        'field.is_multiple_cell_value as isMultipleCellValue',
        'table_meta.db_table_name as dbTableName',
      ])
      .where('field.type', '=', 'user')
      .where('field.is_lookup', 'is', null)
      .where('field.deleted_time', 'is', null)
      .where('table_meta.deleted_time', 'is', null)
      .execute();
  }

  private async patchUserSnapshotTitle(
    db: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
    field: AffectedUserFieldRow,
    userId: string,
    userName: string
  ): Promise<void> {
    const dbTableNameResult = DbTableName.rehydrate(field.dbTableName).andThen((name) =>
      name.split({ defaultSchema: null })
    );
    if (dbTableNameResult.isErr()) {
      throw dbTableNameResult.error;
    }

    const { schema, tableName } = dbTableNameResult.value;
    const tableRef = schema ? sql.id(schema, tableName) : sql.id(tableName);
    const columnRef = sql.ref(field.dbFieldName);
    const nextTitle = sql`to_jsonb(CAST(${userName} AS text))`;

    const statement = field.isMultipleCellValue
      ? sql`
          UPDATE ${tableRef}
          SET ${sql.id(field.dbFieldName)} = (
            SELECT jsonb_agg(
              CASE
                WHEN elem->>'id' = ${userId}
                THEN jsonb_set(elem, '{title}', ${nextTitle})
                ELSE elem
              END
            )
            FROM jsonb_array_elements(${columnRef}) AS elem
          )
        `
      : sql`
          UPDATE ${tableRef}
          SET ${sql.id(field.dbFieldName)} = jsonb_set(${columnRef}, '{title}', ${nextTitle})
          WHERE ${columnRef}->>'id' = ${userId}
        `;

    await db.executeQuery(statement.compile(db));
  }

  private toComputedRefreshChanges(fields: ReadonlyArray<AffectedUserFieldRow>): Result<
    ReadonlyArray<{
      tableId: TableId;
      fieldIds: ReadonlyArray<FieldId>;
    }>,
    DomainError
  > {
    const fieldIdsByTable = new Map<string, Set<string>>();
    for (const field of fields) {
      const fieldIds = fieldIdsByTable.get(field.tableId) ?? new Set<string>();
      fieldIds.add(field.fieldId);
      fieldIdsByTable.set(field.tableId, fieldIds);
    }

    const changes: Array<{ tableId: TableId; fieldIds: ReadonlyArray<FieldId> }> = [];
    for (const [tableIdRaw, fieldIdRaws] of fieldIdsByTable.entries()) {
      const tableIdResult = CoreTableId.create(tableIdRaw);
      if (tableIdResult.isErr()) {
        return err(tableIdResult.error);
      }

      const fieldIds: FieldId[] = [];
      for (const fieldIdRaw of fieldIdRaws) {
        const fieldIdResult = CoreFieldId.create(fieldIdRaw);
        if (fieldIdResult.isErr()) {
          return err(fieldIdResult.error);
        }
        fieldIds.push(fieldIdResult.value);
      }

      changes.push({
        tableId: tableIdResult.value,
        fieldIds,
      });
    }

    return ok(changes);
  }
}
