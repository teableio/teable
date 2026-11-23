import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { FieldType, HttpErrorCode, Relationship, linkFieldOptionsSchema } from '@teable/core';
import { pgErrorCode } from '@teable/v2-adapter-db-postgres-shared';
import {
  domainError,
  type DomainError,
  type IExecutionContext,
  type ISchemaOperationHandler,
  type ISchemaOperationRepository,
  type SchemaOperationRecord,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Knex } from 'knex';
import { sql, type Transaction } from 'kysely';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import { CustomHttpException } from '../../custom.exception';
import { DatabaseRouter } from '../../global/database-router.service';

const operationType = 'host.cross_space_link_conversion';
const recoveryPending = () =>
  new CustomHttpException(
    'A previous base move is awaiting recovery. Retry after recovery completes.',
    HttpErrorCode.CONFLICT,
    { domainCode: 'base.move_recovery_pending' }
  );
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const qualified = (name: string) => {
  const parts = name.split('.');
  if (parts.length !== 2 || parts.some((part) => !part))
    throw new Error('Recovery requires a schema-qualified table');
  return parts.map(quote).join('.');
};

type FieldReceipt = {
  id: string;
  tableId: string;
  dbFieldName: string;
  type: string;
  options: string | null;
  version: number;
  isLookup: boolean | null;
  isConditionalLookup: boolean | null;
  lookupOptions: string | null;
  lookupLinkedFieldId: string | null;
};
type ColumnReceipt = {
  name: string;
  type: string;
  notNull: boolean;
  defaultSql: string | null;
  collation: string | null;
};
type TableReceipt = {
  id: string;
  baseId: string;
  dbTableName: string;
  version: number;
  queryIndexPolicy: unknown;
  backupTable: string;
  columns: ColumnReceipt[];
  indexes: Array<{ name: string; definition: string }>;
  constraints: Array<{ name: string; definition: string }>;
};
export type PairConversionReceipt = {
  version: 1;
  idempotencyKey: string;
  baseId: string;
  sourceConnectionId: string | null;
  fields: FieldReceipt[];
  tables: TableReceipt[];
};

const pairConversionReceiptSchema = z.object({
  version: z.literal(1),
  idempotencyKey: z.string().min(1),
  baseId: z.string(),
  sourceConnectionId: z.string().nullable(),
  fields: z.array(
    z.object({
      id: z.string(),
      tableId: z.string(),
      dbFieldName: z.string(),
      type: z.string(),
      options: z.string().nullable(),
      version: z.number().int(),
      isLookup: z.boolean().nullable(),
      isConditionalLookup: z.boolean().nullable(),
      lookupOptions: z.string().nullable(),
      lookupLinkedFieldId: z.string().nullable(),
    })
  ),
  tables: z.array(
    z.object({
      id: z.string(),
      baseId: z.string(),
      dbTableName: z.string(),
      version: z.number().int(),
      queryIndexPolicy: z.record(z.string(), z.unknown()).nullable(),
      backupTable: z.string(),
      columns: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          notNull: z.boolean(),
          defaultSql: z.string().nullable(),
          collation: z.string().nullable(),
        })
      ),
      indexes: z.array(z.object({ name: z.string(), definition: z.string() })),
      constraints: z.array(z.object({ name: z.string(), definition: z.string() })),
    })
  ),
});

/** Host-only compensation for the exact closed link/dependent conversion batch. */
@Injectable()
export class CrossSpaceLinkConversionRecoveryService implements ISchemaOperationHandler {
  readonly type = operationType;
  private readonly logger = new Logger(CrossSpaceLinkConversionRecoveryService.name);
  constructor(private readonly router: DatabaseRouter) {}

  async withRecovery<T>(
    baseId: string,
    targets: ReadonlyArray<{ tableId: string; fieldId: string }>,
    context: IExecutionContext,
    repository: ISchemaOperationRepository,
    work: (receipt: PairConversionReceipt) => Promise<Result<T, DomainError>>
  ): Promise<Result<T, DomainError>> {
    if (!targets.length)
      return work({
        version: 1,
        idempotencyKey: '',
        baseId,
        sourceConnectionId: null,
        fields: [],
        tables: [],
      });
    // The dedicated connection holds these locks across the native meta/data UoWs.
    // They serialize capture and crash repair; the persisted row lock also makes
    // the existing runner's FOR UPDATE SKIP LOCKED skip a live foreground move.
    return this.router.metaKnex().transaction(async (guard) => {
      await this.lockFields(
        guard,
        targets.map(({ fieldId }) => fieldId)
      );
      const pending = await guard('schema_operation')
        .select('id')
        .where('type', operationType)
        .whereIn('status', ['pending', 'running', 'error', 'dead'])
        .where((query) => {
          for (const { fieldId } of targets) {
            query.orWhereRaw("payload->'fields' @> ?::jsonb", [JSON.stringify([{ id: fieldId }])]);
          }
        })
        .first();
      if (pending) throw recoveryPending();
      const receipt = await this.capture(baseId, targets, guard);
      // Never inherit an outer transaction: this receipt must survive its rollback.
      const durableContext: IExecutionContext = {
        actorId: context.actorId,
        requestId: context.requestId,
      };
      const saved = await repository.upsert(durableContext, {
        type: operationType,
        status: 'pending',
        phase: 'metadata_pending',
        target: { resourceType: 'base', resourceId: baseId, baseId },
        idempotencyKey: receipt.idempotencyKey,
        payload: receipt,
      });
      if (saved.isErr()) throw new Error(saved.error.message);
      const row = await guard('schema_operation')
        .select('status')
        .where('idempotency_key', receipt.idempotencyKey)
        .forUpdate()
        .first();
      if (row?.status !== 'pending')
        throw new Error('Conversion recovery receipt was claimed before admission');
      let value: Result<T, DomainError>;
      try {
        value = await work(receipt);
      } catch (error) {
        await this.settleAfterMove(receipt, guard, false);
        throw error;
      }
      await this.settleAfterMove(receipt, guard, value.isOk());
      return value;
    });
  }

  private async settleAfterMove(
    receipt: PairConversionReceipt,
    guard: Knex.Transaction,
    moved: boolean
  ) {
    try {
      await this.settle(receipt, guard);
      await this.markReady(guard, receipt.idempotencyKey);
    } catch (error) {
      this.logger.error(
        `Conversion recovery remains pending: ${receipt.idempotencyKey}: ${String(error)}`
      );
      // A committed ownership move must still return success if cleanup is deferred.
      if (!moved && pgErrorCode(error) === '55P03') throw recoveryPending();
    }
  }

  async assertUnchanged(
    receipt: PairConversionReceipt,
    metaDb: Transaction<V1TeableDatabase>
  ): Promise<void> {
    if (!receipt.fields.length) return;
    const fields = await metaDb
      .selectFrom('field')
      .select([
        'id',
        'table_id',
        'db_field_name',
        'type',
        'options',
        'version',
        'is_lookup',
        'is_conditional_lookup',
        'lookup_options',
        'lookup_linked_field_id',
      ])
      .where(
        'id',
        'in',
        receipt.fields.map(({ id }) => id)
      )
      .orderBy('id')
      .forUpdate()
      .execute();
    for (const expected of receipt.fields) {
      const field = fields.find(({ id }) => id === expected.id);
      if (
        !field ||
        field.table_id !== expected.tableId ||
        field.db_field_name !== expected.dbFieldName ||
        field.type !== expected.type ||
        field.options !== expected.options ||
        field.version !== expected.version ||
        field.is_lookup !== expected.isLookup ||
        field.is_conditional_lookup !== expected.isConditionalLookup ||
        field.lookup_options !== expected.lookupOptions ||
        field.lookup_linked_field_id !== expected.lookupLinkedFieldId
      ) {
        throw new Error('Cross-space conversion metadata changed before recovery admission');
      }
    }
    const tables = await metaDb
      .selectFrom('table_meta')
      .select(['id', 'base_id', 'db_table_name', 'version', 'query_index_policy'])
      .where(
        'id',
        'in',
        receipt.tables.map(({ id }) => id)
      )
      .orderBy('id')
      .forUpdate()
      .execute();
    for (const expected of receipt.tables) {
      const table = tables.find(({ id }) => id === expected.id);
      if (
        !table ||
        table.base_id !== expected.baseId ||
        table.db_table_name !== expected.dbTableName ||
        table.version !== expected.version ||
        JSON.stringify(table.query_index_policy) !== JSON.stringify(expected.queryIndexPolicy)
      ) {
        throw new Error('Cross-space conversion table layout changed before recovery admission');
      }
    }
  }

  async prepareBackups(
    receipt: PairConversionReceipt,
    dataDb: Transaction<V1TeableDatabase>
  ): Promise<void> {
    if (!receipt.tables.length) {
      return;
    }
    const { rows } = await sql<{ lock: string; statement: string }>`
      SELECT current_setting('lock_timeout') AS lock, current_setting('statement_timeout') AS statement
    `.execute(dataDb);
    await sql`SELECT set_config('lock_timeout', '5s', true),
      set_config('statement_timeout', '60s', true)`.execute(dataDb);
    for (const table of [...receipt.tables].sort((left, right) =>
      left.id.localeCompare(right.id)
    )) {
      // CTAS preserves each actual PostgreSQL source type, including dependent
      // lookup/rollup columns, without bringing any record values into Node.
      const columns = table.columns.map(({ name }) => quote(name));
      await sql
        .raw(`LOCK TABLE ${qualified(table.dbTableName)} IN ACCESS EXCLUSIVE MODE`)
        .execute(dataDb);
      await sql
        .raw(
          `CREATE TABLE ${qualified(table.backupTable)} AS SELECT "__id", ${columns.join(', ')} FROM ${qualified(table.dbTableName)}`
        )
        .execute(dataDb);
    }
    // A statement error aborts the transaction. Only the success path continues into conversion.
    await sql`SELECT set_config('lock_timeout', ${rows[0].lock}, true),
      set_config('statement_timeout', ${rows[0].statement}, true)`.execute(dataDb);
  }

  async run(_context: IExecutionContext, operation: SchemaOperationRecord) {
    try {
      const receipt = this.receipt(operation.payload);
      await this.router.metaKnex().transaction(async (guard) => {
        await this.lockFields(
          guard,
          receipt.fields.map(({ id }) => id)
        );
        const row = await guard('schema_operation')
          .select('status')
          .where('idempotency_key', operation.idempotencyKey)
          .forUpdate()
          .first();
        // A foreground settlement can win after the runner claim but before
        // this lock. Never replay destructive DDL on a terminal receipt.
        if (!row || row.status === 'ready') return;
        await this.settle(receipt, guard);
        await this.markReady(guard, receipt.idempotencyKey);
      });
      return ok({ result: { recovered: true } });
    } catch (error) {
      if (pgErrorCode(error) === '55P03') {
        return err(
          domainError.infrastructure({
            code: 'schema_operation.lock_unavailable',
            message: 'Recovery is waiting for a database lock.',
          })
        );
      }
      return err(
        domainError.infrastructure({ message: `Pair conversion recovery failed: ${String(error)}` })
      );
    }
  }

  private async lockFields(guard: Knex.Transaction, fieldIds: ReadonlyArray<string>) {
    await guard.raw("SET LOCAL lock_timeout = '5s'");
    for (const id of [...new Set(fieldIds)].sort()) {
      await guard.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [
        `pair-conversion:${id}`,
      ]);
    }
  }

  private receipt(payload: unknown): PairConversionReceipt {
    const value = typeof payload === 'string' ? JSON.parse(payload) : payload;
    return pairConversionReceiptSchema.parse(value);
  }

  private async capture(
    baseId: string,
    targets: ReadonlyArray<{ tableId: string; fieldId: string }>,
    guard: Knex.Transaction
  ): Promise<PairConversionReceipt> {
    const rows = await guard('field')
      .select(
        'id',
        'table_id',
        'db_field_name',
        'type',
        'options',
        'version',
        'is_lookup',
        'is_conditional_lookup',
        'lookup_options',
        'lookup_linked_field_id'
      )
      .whereIn(
        'id',
        targets.map(({ fieldId }) => fieldId)
      )
      .whereNull('deleted_time');
    if (
      rows.length !== targets.length ||
      targets.some(
        ({ tableId, fieldId }) =>
          !rows.some((row) => row.id === fieldId && row.table_id === tableId)
      )
    ) {
      throw new Error('Cross-space conversion field set changed');
    }
    const route = await this.router.getDataDatabaseForBase(baseId);
    const receipt: PairConversionReceipt = {
      version: 1,
      idempotencyKey: `pair-conversion:${randomUUID()}`,
      baseId,
      sourceConnectionId: route.connectionId ?? null,
      fields: rows.map((field) => ({
        id: field.id,
        tableId: field.table_id,
        dbFieldName: field.db_field_name,
        type: field.type,
        options: field.options,
        version: field.version,
        isLookup: field.is_lookup,
        isConditionalLookup: field.is_conditional_lookup,
        lookupOptions: field.lookup_options,
        lookupLinkedFieldId: field.lookup_linked_field_id,
      })),
      tables: [],
    };
    return this.router.withDataKnexTransactionForBase(
      baseId,
      { sourceConnectionId: receipt.sourceConnectionId },
      (data) => this.captureTables(receipt, guard, data)
    );
  }

  private async captureTables(
    receipt: PairConversionReceipt,
    guard: Knex.Transaction,
    db: Knex.Transaction
  ): Promise<PairConversionReceipt> {
    for (const id of [...new Set(receipt.fields.map(({ tableId }) => tableId))].sort()) {
      const table = await guard('table_meta')
        .select('id', 'base_id', 'db_table_name', 'version', 'query_index_policy')
        .where('id', id)
        .whereNull('deleted_time')
        .first();
      if (!table) throw new Error('Cross-space conversion table disappeared');
      const names = receipt.fields
        .filter(({ tableId }) => tableId === id)
        .map(({ dbFieldName }) => dbFieldName);
      const columns = await db.raw<{ rows: ColumnReceipt[] }>(
        `
        SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type,
          a.attnotnull AS "notNull", pg_get_expr(d.adbin,d.adrelid) AS "defaultSql",
          CASE WHEN a.attcollation <> 0 THEN quote_ident(n.nspname)||'.'||quote_ident(c.collname) END AS collation
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        LEFT JOIN pg_collation c ON c.oid=a.attcollation LEFT JOIN pg_namespace n ON n.oid=c.collnamespace
        WHERE a.attrelid=?::regclass AND a.attname=ANY(?::text[]) AND a.attnum>0 AND NOT a.attisdropped`,
        [qualified(table.db_table_name), names]
      );
      if (columns.rows.length !== names.length)
        throw new Error('Conversion source physical column is missing');
      const indexes = await db.raw<{ rows: TableReceipt['indexes'] }>(
        `SELECT i.relname AS name, pg_get_indexdef(i.oid) AS definition FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid WHERE x.indrelid=?::regclass`,
        [qualified(table.db_table_name)]
      );
      const constraints = await db.raw<{ rows: TableReceipt['constraints'] }>(
        `SELECT conname AS name, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=?::regclass AND contype <> 'p'`,
        [qualified(table.db_table_name)]
      );
      receipt.tables.push({
        id,
        baseId: table.base_id,
        dbTableName: table.db_table_name,
        version: table.version,
        queryIndexPolicy: table.query_index_policy,
        backupTable: `${table.db_table_name.split('.')[0]}.__pair_backup_${randomUUID().replaceAll('-', '')}`,
        columns: columns.rows,
        indexes: indexes.rows,
        constraints: constraints.rows,
      });
    }
    return receipt;
  }

  private async settle(receipt: PairConversionReceipt, guard: Knex.Transaction): Promise<void> {
    for (const table of [...receipt.tables].sort((left, right) =>
      left.id.localeCompare(right.id)
    )) {
      await guard.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [
        `table-query-index-policy:${table.id}`,
      ]);
    }
    const fields = await guard('field')
      .select(
        'id',
        'type',
        'version',
        'db_field_name',
        'options',
        'is_lookup',
        'is_conditional_lookup',
        'lookup_options',
        'lookup_linked_field_id'
      )
      .whereIn(
        'id',
        receipt.fields.map(({ id }) => id)
      )
      .orderBy('id')
      .forUpdate();
    const original = receipt.fields.every((old) =>
      fields.some(
        (field) =>
          field.id === old.id &&
          field.type === old.type &&
          field.version === old.version &&
          field.db_field_name === old.dbFieldName &&
          field.options === old.options &&
          field.is_lookup === old.isLookup &&
          field.is_conditional_lookup === old.isConditionalLookup &&
          field.lookup_options === old.lookupOptions &&
          field.lookup_linked_field_id === old.lookupLinkedFieldId
      )
    );
    const converted = receipt.fields.every((old) =>
      fields.some(
        (field) =>
          field.id === old.id &&
          field.type === FieldType.SingleLineText &&
          !field.is_lookup &&
          !field.is_conditional_lookup &&
          !field.lookup_options &&
          !field.lookup_linked_field_id &&
          (!field.options || field.options === '{}') &&
          (field.version > old.version ||
            (old.type === FieldType.SingleLineText &&
              !old.isLookup &&
              field.version === old.version)) &&
          field.db_field_name === old.dbFieldName
      )
    );
    if (!original && !converted)
      throw new Error(
        'Recovery cannot classify committed pair metadata; retained sources were preserved'
      );
    const tables = await guard('table_meta')
      .select('id', 'base_id', 'db_table_name', 'version', 'query_index_policy')
      .whereIn(
        'id',
        receipt.tables.map(({ id }) => id)
      )
      .orderBy('id')
      .forUpdate();
    if (
      receipt.tables.some(
        (expected) =>
          !tables.some(
            (table) =>
              table.id === expected.id &&
              table.base_id === expected.baseId &&
              table.db_table_name === expected.dbTableName &&
              (!original ||
                (table.version === expected.version &&
                  JSON.stringify(table.query_index_policy) ===
                    JSON.stringify(expected.queryIndexPolicy)))
          )
      )
    ) {
      throw new Error(
        'Recovery table ownership or physical layout changed; retained sources were preserved'
      );
    }
    const settleData = async (data: Knex.Transaction) => {
      await data.raw("SET LOCAL lock_timeout = '5s'");
      // The guard serializes settlement. If backup creation rolled back, there is
      // no physical work to undo and a reader should never delay this receipt.
      if (original) {
        const backups = await data.raw<{ rows: unknown[] }>(
          'SELECT 1 FROM unnest(?::text[]) AS backups(name) WHERE to_regclass(name) IS NOT NULL LIMIT 1',
          [receipt.tables.map(({ backupTable }) => qualified(backupTable))]
        );
        if (!backups.rows.length) return;
      }
      for (const table of [...receipt.tables].sort((left, right) =>
        left.id.localeCompare(right.id)
      )) {
        await data.raw(
          `LOCK TABLE ${qualified(table.dbTableName)} IN ACCESS EXCLUSIVE MODE NOWAIT`
        );
      }
      for (const table of receipt.tables) {
        const exists = await data.raw<{ rows: Array<{ present: boolean }> }>(
          'SELECT to_regclass(?) IS NOT NULL AS present',
          [qualified(table.backupTable)]
        );
        if (!exists.rows[0]?.present) continue; // data rolled back, or an earlier repair already committed.
        if (original) {
          for (const column of table.columns) {
            await data.raw(
              `ALTER TABLE ${qualified(table.dbTableName)} DROP COLUMN IF EXISTS ${quote(column.name)}`
            );
            await data.raw(
              `ALTER TABLE ${qualified(table.dbTableName)} ADD COLUMN ${quote(column.name)} ${column.type}${column.collation ? ` COLLATE ${column.collation}` : ''}`
            );
          }
          const assignments = table.columns
            .map(({ name }) => `${quote(name)} = backup.${quote(name)}`)
            .join(', ');
          await data.raw(
            `UPDATE ${qualified(table.dbTableName)} AS target SET ${assignments} FROM ${qualified(table.backupTable)} AS backup WHERE target."__id"=backup."__id"`
          );
          // Retained link source columns still own their old indexes and
          // constraints. Remove them before recreating the original layout.
          for (const field of receipt.fields.filter(
            ({ tableId, type, isLookup }) =>
              tableId === table.id && type === FieldType.Link && !isLookup
          )) {
            await data.raw(
              `ALTER TABLE ${qualified(table.dbTableName)} DROP COLUMN IF EXISTS ${quote(`__tmp_link_src_${field.id}`)}`
            );
          }
          for (const column of table.columns) {
            if (column.defaultSql)
              await data.raw(
                `ALTER TABLE ${qualified(table.dbTableName)} ALTER COLUMN ${quote(column.name)} SET DEFAULT ${column.defaultSql}`
              );
            if (column.notNull)
              await data.raw(
                `ALTER TABLE ${qualified(table.dbTableName)} ALTER COLUMN ${quote(column.name)} SET NOT NULL`
              );
          }
          for (const constraint of table.constraints) {
            const existing = await data.raw<{ rows: unknown[] }>(
              'SELECT 1 FROM pg_constraint WHERE conrelid=?::regclass AND conname=?',
              [qualified(table.dbTableName), constraint.name]
            );
            if (!existing.rows.length)
              await data.raw(
                `ALTER TABLE ${qualified(table.dbTableName)} ADD CONSTRAINT ${quote(constraint.name)} ${constraint.definition}`
              );
          }
          for (const index of table.indexes) {
            const name = `${table.dbTableName.split('.')[0]}.${index.name}`;
            const existing = await data.raw<{ rows: Array<{ present: boolean }> }>(
              'SELECT to_regclass(?) IS NOT NULL AS present',
              [qualified(name)]
            );
            if (!existing.rows[0]?.present) await data.raw(index.definition);
          }
        }
        for (const field of receipt.fields.filter(
          ({ tableId, type, isLookup }) =>
            tableId === table.id && type === FieldType.Link && !isLookup
        )) {
          await data.raw(
            `ALTER TABLE ${qualified(table.dbTableName)} DROP COLUMN IF EXISTS ${quote(`__tmp_link_src_${field.id}`)}`
          );
        }
      }
      if (converted) await this.cleanLinkStorage(receipt, data);
      for (const table of receipt.tables)
        await data.raw(`DROP TABLE IF EXISTS ${qualified(table.backupTable)}`);
    };
    await this.router.withDataKnexTransactionForBase(
      receipt.baseId,
      { sourceConnectionId: receipt.sourceConnectionId },
      settleData
    );
  }

  private async cleanLinkStorage(receipt: PairConversionReceipt, data: Knex.Transaction) {
    const cleaned = new Set<string>();
    for (const field of receipt.fields) {
      if (field.type !== FieldType.Link || field.isLookup || !field.options) continue;
      const options = linkFieldOptionsSchema.parse(JSON.parse(field.options));
      const {
        fkHostTableName: host,
        relationship,
        selfKeyName,
        foreignKeyName,
        isOneWay,
      } = options;
      const dropTable =
        relationship === Relationship.ManyMany ||
        (relationship === Relationship.OneMany && isOneWay);
      if (dropTable && host.includes('junction_')) {
        if (!cleaned.has(host)) await data.raw(`DROP TABLE IF EXISTS ${qualified(host)}`);
        cleaned.add(host);
        continue;
      }
      const column =
        relationship === Relationship.ManyOne
          ? foreignKeyName
          : relationship === Relationship.OneMany && !isOneWay
            ? selfKeyName
            : relationship === Relationship.OneOne
              ? foreignKeyName === '__id'
                ? selfKeyName
                : foreignKeyName
              : undefined;
      if (!column || cleaned.has(`${host}:${column}`)) continue;
      cleaned.add(`${host}:${column}`);
      for (const name of [column, `${column}_order`]) {
        await data.raw(
          `DROP INDEX IF EXISTS ${quote(host.split('.')[0])}.${quote(`index_${name}`)}`
        );
        await data.raw(`ALTER TABLE ${qualified(host)} DROP COLUMN IF EXISTS ${quote(name)}`);
      }
    }
  }

  private async markReady(guard: Knex.Transaction, key: string) {
    await guard('schema_operation').where('idempotency_key', key).update({
      status: 'ready',
      phase: 'ready',
      locked_at: null,
      locked_by: null,
      last_error: null,
      last_modified_time: new Date(),
    });
  }
}
