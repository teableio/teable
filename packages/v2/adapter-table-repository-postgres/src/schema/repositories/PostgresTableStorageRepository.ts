import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-shared';
import {
  domainError,
  type DomainError,
  type IExecutionContext,
  type ITableStorageRepository,
  type TableStorageRenameResult,
  type ILogger,
  v2CoreTokens,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

@injectable()
export class PostgresTableStorageRepository implements ITableStorageRepository {
  constructor(
    @inject(v2MetaDbTokens.db) private readonly metaDb: Kysely<V1TeableDatabase>,
    @inject(v2DataDbTokens.db) private readonly dataDb: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.logger) private readonly logger: ILogger
  ) {}

  private async renamePhysical(from: string, to: string) {
    const split = (name: string) => {
      const separator = name.indexOf('.');
      return separator < 0
        ? { schema: 'public', name }
        : { schema: name.slice(0, separator), name: name.slice(separator + 1) };
    };
    const source = split(from);
    const target = split(to);
    await this.dataDb.transaction().execute(async (trx) => {
      if (source.schema !== target.schema) {
        await sql`alter table ${sql.id(source.schema, source.name)} set schema ${sql.id(target.schema)}`.execute(
          trx
        );
      }
      if (source.name !== target.name) {
        await sql`alter table ${sql.id(target.schema, source.name)} rename to ${sql.id(target.name)}`.execute(
          trx
        );
      }
    });
  }

  async rename(
    context: IExecutionContext,
    input: Parameters<ITableStorageRepository['rename']>[1]
  ): Promise<Result<TableStorageRenameResult, DomainError>> {
    const nameResult = input.dbTableName.value();
    if (nameResult.isErr()) return err(nameResult.error);
    const baseId = input.baseId.toString();
    const tableId = input.tableId.toString();
    const dbTableName = nameResult.value;
    let renamedFrom: string | undefined;
    try {
      return await this.metaDb.transaction().execute(async (trx) => {
        const duplicate = await trx
          .selectFrom('table_meta')
          .select('id')
          .where('base_id', '=', baseId)
          .where('db_table_name', '=', dbTableName)
          .where('deleted_time', 'is', null)
          .executeTakeFirst();
        if (duplicate)
          return err(
            domainError.validation({
              code: 'table.db_table_name_exists',
              message: `dbTableName ${dbTableName} already exists`,
            })
          );
        const previous = await trx
          .selectFrom('table_meta')
          .select(['db_table_name', 'version', 'last_modified_time', 'last_modified_by'])
          .where('id', '=', tableId)
          .where('base_id', '=', baseId)
          .where('deleted_time', 'is', null)
          .forUpdate()
          .executeTakeFirst();
        if (!previous)
          return err(
            domainError.notFound({ code: 'table.not_found', message: `table ${tableId} not found` })
          );
        await this.renamePhysical(previous.db_table_name, dbTableName);
        renamedFrom = previous.db_table_name;
        const lastModifiedTime = new Date().toISOString();
        const lastModifiedBy = context.actorId.toString();
        // Keep the historical serialized metadata while updating every physical link reference.
        await sql`update field set options = jsonb_set(options::jsonb, '{fkHostTableName}', to_jsonb(${dbTableName}::text))::text
          where type = 'link' and options::jsonb ->> 'fkHostTableName' = ${previous.db_table_name}`.execute(
          trx
        );
        await sql`update field set lookup_options = jsonb_set(lookup_options::jsonb, '{fkHostTableName}', to_jsonb(${dbTableName}::text))::text
          where lookup_options::jsonb ->> 'fkHostTableName' = ${previous.db_table_name}
            and lookup_options::jsonb ? 'linkFieldId'`.execute(trx);
        await trx
          .updateTable('table_meta')
          .set({
            db_table_name: dbTableName,
            version: previous.version + 1,
            last_modified_time: new Date(lastModifiedTime),
            last_modified_by: lastModifiedBy,
          })
          .where('id', '=', tableId)
          .executeTakeFirstOrThrow();
        return ok({
          previousDbTableName: previous.db_table_name,
          dbTableName,
          previousVersion: previous.version,
          previousLastModifiedTime: previous.last_modified_time?.toISOString() ?? null,
          previousLastModifiedBy: previous.last_modified_by,
          lastModifiedTime,
          lastModifiedBy,
        });
      });
    } catch (cause) {
      if (renamedFrom) {
        try {
          await this.renamePhysical(dbTableName, renamedFrom);
        } catch (rollbackError) {
          this.logger.error('Failed to rollback data table rename', {
            tableId,
            from: dbTableName,
            to: renamedFrom,
            rollbackError,
          });
        }
      }
      return err(
        domainError.infrastructure({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        })
      );
    }
  }
}
