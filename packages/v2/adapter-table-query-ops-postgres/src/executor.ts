import {
  domainError,
  TableByIdSpec,
  TableId,
  type DomainError,
  type IExecutionContext,
  type ITableRepository,
} from '@teable/v2-core';
import type {
  ExecutablePhase1RemediationKind,
  TableQueryRemediationExecutor,
  TableQueryRemediationTask,
  TableSearchVectorReconciler,
} from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import { makePhysicalTableSql, quoteIdentifier, toInfrastructureError } from './helpers';
import { PostgresTableSearchVectorExecutor } from './searchVector';
import type { UnknownPostgresDatabase } from './types';

type TableMetaRow = {
  readonly base_id: string;
  readonly db_table_name: string;
};

const manualSearchVectorTaskKinds: Partial<Record<ExecutablePhase1RemediationKind, true>> = {
  create_search_vector: true,
  rebuild_search_vector: true,
};

export class PostgresTableQueryRemediationExecutor implements TableQueryRemediationExecutor {
  constructor(
    private readonly metaDb: Kysely<UnknownPostgresDatabase>,
    private readonly dataDb: Kysely<UnknownPostgresDatabase>,
    private readonly tableRepository?: ITableRepository,
    private readonly searchVectorReconciler?: TableSearchVectorReconciler
  ) {}

  async execute(
    context: IExecutionContext,
    input: {
      readonly task: TableQueryRemediationTask;
      readonly allowManualIndexExecution: boolean;
    }
  ): Promise<Result<unknown, DomainError>> {
    const task = input.task.snapshot();
    if (task.kind === 'manual_investigation') {
      return ok({ skipped: true, reason: 'manual investigation task' });
    }
    if (task.kind === 'rebuild_search_vector' && isSchemaMaintenancePayload(task.payload)) {
      return this.executeSearchVectorSchemaMaintenance(context, task);
    }
    if (!input.allowManualIndexExecution) {
      return ok({ skipped: true, reason: 'manual index execution disabled' });
    }
    if (manualSearchVectorTaskKinds[task.kind]) {
      try {
        const executor = new PostgresTableSearchVectorExecutor(this.metaDb, this.dataDb);
        return ok(
          await executor.execute({
            tableId: task.tableId,
            payload: task.payload as Parameters<
              PostgresTableSearchVectorExecutor['execute']
            >[0]['payload'],
          })
        );
      } catch (error) {
        return err(toInfrastructureError(error, 'Failed to execute search vector remediation'));
      }
    }
    const payload = task.payload as {
      readonly fieldDbName?: string;
      readonly fieldId?: string;
      readonly fields?: ReadonlyArray<{
        readonly fieldId?: string;
        readonly fieldDbName?: string;
        readonly direction?: 'asc' | 'desc';
      }>;
      readonly indexKind?: 'btree' | 'gin_trgm';
    };
    const fields =
      payload.fields?.filter((field) => field.fieldDbName) ??
      (payload.fieldDbName ? [{ fieldId: payload.fieldId, fieldDbName: payload.fieldDbName }] : []);
    if (fields.length === 0 || !payload.indexKind) {
      return err(
        domainError.validation({
          code: 'table_query_ops.invalid_index_task_payload',
          message: 'Index remediation task payload must include index fields and indexKind',
        })
      );
    }
    try {
      const tableMeta = await this.findTableMeta(task.tableId);
      if (!tableMeta) {
        return err(domainError.notFound({ message: 'Table meta not found for remediation task' }));
      }
      const physical = splitPhysicalName(tableMeta.db_table_name, tableMeta.base_id);
      const indexName = buildIndexName(
        task.tableId,
        fields.map((field) => field.fieldDbName ?? '').join('_'),
        payload.indexKind
      );
      if (payload.indexKind === 'gin_trgm') {
        await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(this.dataDb);
      }
      const using = payload.indexKind === 'gin_trgm' ? 'gin' : 'btree';
      const fieldSql = buildIndexFieldSql(fields, payload.indexKind);
      await sql
        .raw(
          `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${quoteIdentifier(indexName)} ON ${makePhysicalTableSql(
            physical.schema,
            physical.tableName
          )} USING ${using} (${fieldSql})`
        )
        .execute(this.dataDb);
      return ok({
        createdOrVerified: true,
        indexName,
        indexKind: payload.indexKind,
        fieldId: payload.fieldId,
        fieldDbName: payload.fieldDbName,
        fields,
      });
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to execute table query remediation task'));
    }
  }

  private async executeSearchVectorSchemaMaintenance(
    context: IExecutionContext,
    task: ReturnType<TableQueryRemediationTask['snapshot']>
  ): Promise<Result<unknown, DomainError>> {
    if (!this.tableRepository || !this.searchVectorReconciler) {
      return err(
        domainError.infrastructure({
          message: 'Search vector schema maintenance dependencies are not registered',
        })
      );
    }

    const tableId = TableId.create(task.tableId);
    if (tableId.isErr()) return err(tableId.error);
    const table = await this.tableRepository.findOne(context, TableByIdSpec.create(tableId.value));
    if (table.isErr()) return err(table.error);

    return this.searchVectorReconciler.maintainAfterSchemaChange(context, table.value);
  }

  private async findTableMeta(tableId: string): Promise<TableMetaRow | undefined> {
    const result = await sql<TableMetaRow>`
      SELECT base_id, db_table_name
      FROM table_meta
      WHERE id = ${tableId}
      LIMIT 1
    `.execute(this.metaDb);
    return result.rows[0];
  }
}

const isSchemaMaintenancePayload = (payload: unknown): boolean =>
  typeof payload === 'object' &&
  payload !== null &&
  'trigger' in payload &&
  payload.trigger === 'schema_change';

const splitPhysicalName = (
  dbTableName: string,
  defaultSchema: string
): { readonly schema: string; readonly tableName: string } => {
  const dotIndex = dbTableName.indexOf('.');
  if (dotIndex === -1) {
    return { schema: defaultSchema, tableName: dbTableName };
  }
  return { schema: dbTableName.slice(0, dotIndex), tableName: dbTableName.slice(dotIndex + 1) };
};

const buildIndexFieldSql = (
  fields: ReadonlyArray<{
    readonly fieldDbName?: string;
    readonly direction?: 'asc' | 'desc';
  }>,
  indexKind: 'btree' | 'gin_trgm'
): string => {
  if (indexKind === 'gin_trgm') {
    return `${quoteIdentifier(fields[0]?.fieldDbName ?? '')} gin_trgm_ops`;
  }
  return fields
    .map((field) => {
      const direction = field.direction ? ` ${field.direction.toUpperCase()}` : '';
      return `${quoteIdentifier(field.fieldDbName ?? '')}${direction}`;
    })
    .join(', ');
};

const buildIndexName = (tableId: string, fieldDbName: string, indexKind: string): string => {
  const safeField = fieldDbName.replace(/\W/g, '_').slice(0, 24);
  return `tqops_${tableId}_${safeField}_${indexKind}`.slice(0, 60);
};
