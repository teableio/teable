/* eslint-disable @typescript-eslint/naming-convention */
import { ConflictException } from '@nestjs/common';
import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import type { DependencyContainer } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

type ProvisionDatabase = V1TeableDatabase & {
  base_node: { id: string; base_id: string; resource_id: string; parent_id: string | null };
};

export type ProvisionOperation = {
  id: string;
  table_id: string | null;
  resource_id: string;
  type: string;
  status: string;
  payload: unknown;
  last_error: string | null;
};

const isMultiTableOperation = (payload: unknown): boolean =>
  payload != null &&
  typeof payload === 'object' &&
  'tableIds' in payload &&
  Array.isArray(payload.tableIds) &&
  payload.tableIds.length > 1;

export function operationTargetsTable(operation: ProvisionOperation, tableId: string): boolean {
  if (operation.table_id === tableId || operation.resource_id === tableId) return true;
  const payload = operation.payload;
  if (!payload || typeof payload !== 'object') return false;
  return (
    ('tableId' in payload && payload.tableId === tableId) ||
    ('tableIds' in payload && Array.isArray(payload.tableIds) && payload.tableIds.includes(tableId))
  );
}

/** Input is newest first. A dead historical operation never overrides a newer/live one. */
export function terminalTableFailure(operations: ProvisionOperation[], tableId: string) {
  const relevant = operations.filter((operation) => operationTargetsTable(operation, tableId));
  if (relevant.some((operation) => ['pending', 'running', 'error'].includes(operation.status)))
    return;
  const latest = relevant[0];
  return latest?.status === 'dead' ? latest : undefined;
}

export async function listFailedTableProvisions(container: DependencyContainer, baseId: string) {
  const db = container.resolve<Kysely<ProvisionDatabase>>(v2MetaDbTokens.db);
  // Filter and classify in PostgreSQL. Never hydrate the base's operation history
  // (including large import payloads) for each sidebar poll.
  const targetsCandidate = sql`(operation.table_id = candidate.id
    or operation.resource_id = candidate.id
    or operation.payload->>'tableId' = candidate.id
    or operation.payload->'tableIds' @> jsonb_build_array(candidate.id))`;
  const { rows } = await sql<{
    id: string;
    name: string;
    operation_id: string;
    operation_type: string;
  }>`select candidate.id, candidate.name,
      latest.id as operation_id, latest.type as operation_type
    from table_meta as candidate
    join lateral (
      select operation.id, operation.type, operation.status
      from schema_operation as operation
      where operation.base_id = ${baseId} and ${targetsCandidate}
      order by operation.created_time desc, operation.id desc
      limit 1
    ) as latest on latest.status = 'dead'
    where candidate.base_id = ${baseId}
      and candidate.deleted_time is null
      and candidate.provision_state in ('pending', 'error')
      and not exists (
        select 1 from schema_operation as operation
        where operation.base_id = ${baseId}
          and operation.status in ('pending', 'running', 'error')
          and ${targetsCandidate}
      )
    order by candidate."order"`.execute(db);
  return rows.map((table) => ({
    id: table.id,
    name: table.name,
    operationId: table.operation_id,
    operationType: table.operation_type,
    // Raw DB errors can contain connection details; keep diagnostics in the ledger.
    reason:
      table.operation_type === 'table.import'
        ? 'Import could not be completed automatically. Import the source again to retry.'
        : 'Table setup failed and could not be repaired automatically.',
  }));
}

async function assertNoNestedNodes(tx: Kysely<ProvisionDatabase>, tableId: string): Promise<void> {
  const nodes = await tx
    .selectFrom('base_node')
    .select('id')
    .where('resource_id', '=', tableId)
    .execute();
  if (nodes.length) {
    const children = await tx
      .selectFrom('base_node')
      .select('id')
      .where(
        'parent_id',
        'in',
        nodes.map((n) => n.id)
      )
      .limit(1)
      .execute();
    if (children.length) throw new ConflictException('Import has nested resources');
  }
}

/** Returns true only when an isolated empty failed import is newly cleaned up. */
export async function cleanupFailedTableProvision(
  container: DependencyContainer,
  baseId: string,
  tableId: string
): Promise<boolean> {
  const meta = container.resolve<Kysely<ProvisionDatabase>>(v2MetaDbTokens.db);
  const data = container.resolve<Kysely<ProvisionDatabase>>(v2DataDbTokens.db);
  return meta.transaction().execute(async (tx) => {
    const table = await tx
      .selectFrom('table_meta')
      .selectAll()
      .where('id', '=', tableId)
      .where('base_id', '=', baseId)
      .forUpdate()
      .executeTakeFirst();
    if (!table) throw new ConflictException('Failed import metadata is missing');
    const operations = await tx
      .selectFrom('schema_operation')
      .selectAll()
      .where('base_id', '=', baseId)
      .where(
        sql<boolean>`(table_id = ${tableId} or resource_id = ${tableId}
        or payload->>'tableId' = ${tableId}
        or payload->'tableIds' @> ${JSON.stringify([tableId])}::jsonb)`
      )
      .orderBy('created_time', 'desc')
      .orderBy('id', 'desc')
      .forUpdate()
      .execute();
    const failure = terminalTableFailure(operations, tableId);
    if (!failure || failure.type !== 'table.import') {
      throw new ConflictException(
        'Cleanup requires a terminal failed import with no active operation'
      );
    }
    // A tombstone plus its terminal import is the idempotency record.
    if (table.deleted_time) return false;
    if (!['pending', 'error'].includes(table.provision_state)) {
      throw new ConflictException('Only unavailable failed imports can be cleaned up');
    }
    if (isMultiTableOperation(failure.payload)) {
      throw new ConflictException('Multi-table imports require coordinated cleanup');
    }
    const fields = await tx
      .selectFrom('field')
      .select(['id', 'type', 'options'])
      .where('table_id', '=', tableId)
      .execute();
    if (fields.some((field) => field.type === 'link')) {
      throw new ConflictException('Import has link resources that require coordinated cleanup');
    }
    const incoming = await sql<{ id: string }>`select id from field
      where type = 'link' and options::jsonb->>'foreignTableId' = ${tableId} limit 1`.execute(tx);
    if (incoming.rows.length) throw new ConflictException('Other tables reference this import');
    if (fields.length) {
      const references = await tx
        .selectFrom('reference')
        .select('id')
        .where((eb) =>
          eb.or([
            eb(
              'from_field_id',
              'in',
              fields.map((f) => f.id)
            ),
            eb(
              'to_field_id',
              'in',
              fields.map((f) => f.id)
            ),
          ])
        )
        .limit(1)
        .execute();
      if (references.length) throw new ConflictException('Import has field dependencies');
    }
    await assertNoNestedNodes(tx, tableId);
    const otherOwner = await tx
      .selectFrom('table_meta')
      .select('id')
      .where('db_table_name', '=', table.db_table_name)
      .where('id', '!=', tableId)
      .limit(1)
      .execute();
    if (otherOwner.length) throw new ConflictException('Physical table has another metadata owner');
    const parts = table.db_table_name.split('.');
    if (parts.length !== 2 || parts[0] !== baseId) {
      throw new ConflictException('Physical table ownership could not be verified');
    }
    await data.transaction().execute(async (dataTx) => {
      await sql`set local lock_timeout = '3s'`.execute(dataTx);
      await sql`set local statement_timeout = '10s'`.execute(dataTx);
      const relation = await sql<{
        oid: number;
        relkind: string;
      }>`select c.oid, c.relkind from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = ${parts[0]} and c.relname = ${parts[1]}`.execute(dataTx);
      if (!relation.rows.length) return;
      if (relation.rows[0].relkind !== 'r')
        throw new ConflictException('Physical relation is not an ordinary owned table');
      // Hold the physical lock from inspection through DROP, preventing a late writer.
      await sql`lock table ${sql.id(...parts)} in access exclusive mode`.execute(dataTx);
      const constraints = await sql<{ oid: number }>`select oid from pg_constraint
        where contype = 'f' and (conrelid = ${relation.rows[0].oid} or confrelid = ${relation.rows[0].oid}) limit 1`.execute(
        dataTx
      );
      if (constraints.rows.length)
        throw new ConflictException('Physical relationships require coordinated cleanup');
      const rows = await sql<{
        count: string;
      }>`select count(*)::text as count from ${sql.id(...parts)}`.execute(dataTx);
      if (rows.rows[0].count !== '0')
        throw new ConflictException('Import contains records; automatic cleanup is disabled');
      await sql`drop table ${sql.id(...parts)} restrict`.execute(dataTx);
    });
    // If meta commit fails after data DROP, retry observes a missing relation and finishes here.
    const now = new Date();
    await tx
      .updateTable('field')
      .set({ deleted_time: now })
      .where('table_id', '=', tableId)
      .execute();
    await tx
      .updateTable('view')
      .set({ deleted_time: now })
      .where('table_id', '=', tableId)
      .execute();
    await tx
      .deleteFrom('base_node')
      .where('base_id', '=', baseId)
      .where('resource_id', '=', tableId)
      .execute();
    await tx
      .updateTable('table_meta')
      .set({ deleted_time: now })
      .where('id', '=', tableId)
      .execute();
    return true;
  });
}
