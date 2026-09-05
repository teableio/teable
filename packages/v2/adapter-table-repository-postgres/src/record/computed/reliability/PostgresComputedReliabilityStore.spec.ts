import { computedReliabilitySchemaSql } from '@teable/v2-postgres-schema';
import { PostgresQueryCompiler, sql, type Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPGliteDb } from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import type { DynamicDB } from '../../query-builder';
import { PostgresComputedReliabilityStore } from './PostgresComputedReliabilityStore';

describe('durable computed failure evidence', () => {
  let db: Kysely<DynamicDB>;
  let store: PostgresComputedReliabilityStore;
  beforeEach(async () => {
    db = (await createPGliteDb()).db as unknown as Kysely<DynamicDB>;
    for (const statement of computedReliabilitySchemaSql.split(';').filter((part) => part.trim())) {
      await sql.raw(statement).execute(db);
    }
    await sql`create table computed_task_field_ref(task_id text,field_id text,table_id text)`.execute(
      db
    );
    store = new PostgresComputedReliabilityStore(db);
  });
  afterEach(async () => {
    await db.destroy();
  });
  const failure = () => ({ taskId: 'a', baseId: 'base', sourceTableId: 'table', error: 'timeout' });

  it('requires all columns and conflict keys, not just relation names', async () => {
    expect(await store.isReady()).toBe(true);
    await sql`alter table computed_reliability_issue drop column failure_kind`.execute(db);
    expect(await store.isReady()).toBe(false);
    await sql`alter table computed_reliability_issue add column failure_kind text`.execute(db);
    expect(await store.isReady()).toBe(true);
    await sql`alter table computed_reliability_issue drop constraint computed_reliability_issue_task_id_key`.execute(
      db
    );
    expect(await store.isReady()).toBe(false);
  });

  it('rejects missing required defaults and row-level security', async () => {
    await sql`alter table computed_reliability_issue alter column occurrences drop default`.execute(
      db
    );
    expect(await store.isReady()).toBe(false);
    await sql`alter table computed_reliability_issue alter column occurrences set default 1`.execute(
      db
    );
    expect(await store.isReady()).toBe(true);
    await sql`alter table computed_reliability_scope enable row level security`.execute(db);
    expect(await store.isReady()).toBe(false);
    await sql`alter table computed_reliability_scope disable row level security`.execute(db);
    expect(await store.isReady()).toBe(true);
    await sql`alter table computed_reliability_issue alter column status drop not null`.execute(db);
    expect(await store.isReady()).toBe(false);
  });

  it('checks the current runtime role actual write privileges', async () => {
    await sql`create role evidence_reader`.execute(db);
    await sql`grant usage on schema public to evidence_reader`.execute(db);
    await sql`grant select on computed_reliability_issue,computed_reliability_scope to evidence_reader`.execute(
      db
    );
    await db.transaction().execute(async (trx) => {
      await sql`set local role evidence_reader`.execute(trx);
      expect(await new PostgresComputedReliabilityStore(trx).isReady()).toBe(false);
    });
    await sql`grant insert,update on computed_reliability_issue to evidence_reader`.execute(db);
    await sql`grant insert on computed_reliability_scope to evidence_reader`.execute(db);
    await db.transaction().execute(async (trx) => {
      await sql`set local role evidence_reader`.execute(trx);
      expect(await new PostgresComputedReliabilityStore(trx).isReady()).toBe(false);
    });
    await sql`grant delete on computed_reliability_issue,computed_reliability_scope to evidence_reader`.execute(
      db
    );
    await db.transaction().execute(async (trx) => {
      await sql`set local role evidence_reader`.execute(trx);
      expect(await new PostgresComputedReliabilityStore(trx).isReady()).toBe(true);
    });
  });

  it('returns unavailable without throwing when runtime lacks schema usage', async () => {
    await sql`create schema hidden_ledger`.execute(db);
    await db.transaction().execute(async (trx) => {
      await sql`set local search_path to hidden_ledger`.execute(trx);
      for (const statement of computedReliabilitySchemaSql
        .split(';')
        .filter((part) => part.trim())) {
        await sql.raw(statement).execute(trx);
      }
    });
    await sql`create role schema_denied`.execute(db);
    await db.transaction().execute(async (trx) => {
      await sql`set local role schema_denied`.execute(trx);
      expect(
        await new PostgresComputedReliabilityStore(trx.withSchema('hidden_ledger')).isReady()
      ).toBe(false);
    });
  });

  it('bounds evidence writes without relaxing tighter transaction timeouts and restores them', async () => {
    await db.transaction().execute(async (trx) => {
      await sql`set local lock_timeout = 100`.execute(trx);
      await sql`set local statement_timeout = 1500`.execute(trx);
      await sql`create function check_evidence_timeout() returns trigger language plpgsql as $$
        begin
          if current_setting('lock_timeout')::interval > interval '100 milliseconds'
            or current_setting('statement_timeout')::interval > interval '1500 milliseconds' then
            raise exception 'Evidence relaxed caller timeout';
          end if;
          return new;
        end $$`.execute(trx);
      await sql`create trigger evidence_budget before insert on computed_reliability_issue
        for each row execute function check_evidence_timeout()`.execute(trx);
      await new PostgresComputedReliabilityStore(trx).recordFailure(failure());
      const settings = await sql<{ lock: string; statement: string }>`select
        current_setting('lock_timeout') as lock,current_setting('statement_timeout') as statement`.execute(
        trx
      );
      expect(settings.rows[0]).toEqual({ lock: '100ms', statement: '1500ms' });
    });
  });

  it('keeps old durable failure writes usable when migrations are absent', async () => {
    await sql`drop table computed_reliability_scope`.execute(db);
    await sql`create table legacy_dead_letter(id text)`.execute(db);
    await db.transaction().execute(async (trx) => {
      await sql`insert into legacy_dead_letter values('a')`.execute(trx);
      const unavailable = new PostgresComputedReliabilityStore(trx);
      expect(await unavailable.isReady()).toBe(false);
      await unavailable.recordFailure(failure());
    });
    expect((await sql`select id from legacy_dead_letter`.execute(db)).rows).toEqual([{ id: 'a' }]);
  });

  it('captures deduplicated scope before refs disappear in one bulk insert', async () => {
    await sql`insert into computed_task_field_ref values('a','field','table')`.execute(db);
    const statements: string[] = [];
    const observed = db.withPlugin({
      transformQuery(args) {
        statements.push(new PostgresQueryCompiler().compileQuery(args.node).sql);
        return args.node;
      },
      async transformResult(args) {
        return args.result;
      },
    });
    await observed.transaction().execute(async (trx) => {
      await new PostgresComputedReliabilityStore(trx).recordFailure({
        ...failure(),
        targets: [
          { tableId: 'table', fieldId: 'field' },
          { tableId: 'table', fieldId: 'other' },
        ],
      });
      await sql`delete from computed_task_field_ref`.execute(trx);
    });
    expect((await store.getFieldSummaries('table')).map((item) => item.fieldId).sort()).toEqual([
      'field',
      'other',
    ]);
    expect(
      statements.filter((statement) =>
        statement.startsWith('insert into "computed_reliability_scope"')
      )
    ).toHaveLength(1);
    await store.recordFailure(failure());
    expect((await store.listIssues())[0]).toMatchObject({ status: 'open', occurrences: 2 });
  });

  it('bounds bulk scope writes for large dependency graphs', async () => {
    const statements: string[] = [];
    const observed = db.withPlugin({
      transformQuery(args) {
        statements.push(new PostgresQueryCompiler().compileQuery(args.node).sql);
        return args.node;
      },
      async transformResult(args) {
        return args.result;
      },
    });
    await new PostgresComputedReliabilityStore(observed).recordFailure({
      ...failure(),
      targets: Array.from({ length: 1001 }, (_, index) => ({
        tableId: 'table',
        fieldId: `field${index}`,
      })),
    });
    expect(
      statements.filter((statement) =>
        statement.startsWith('insert into "computed_reliability_scope"')
      )
    ).toHaveLength(2);
    expect(await store.getFieldSummaries('table', true)).toHaveLength(1001);
  });

  it('rolls back evidence with its owning transaction', async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await new PostgresComputedReliabilityStore(trx).recordFailure(failure());
        throw new Error('abort');
      })
    ).rejects.toThrow('abort');
    expect(await store.listIssues()).toEqual([]);
  });

  it('retains unknown scope until explicitly resolved outside task execution', async () => {
    await store.recordFailure({
      ...failure(),
      failureKind: 'statement_timeout',
      failurePhase: 'execute_plan',
    });
    expect((await store.listIssues())[0]).toMatchObject({
      scope_complete: false,
      failure_kind: 'statement_timeout',
      failure_phase: 'execute_plan',
    });
    expect(await store.getUnknownScopeSummary('table')).toMatchObject({
      unresolvedCount: 1,
      scopeComplete: false,
    });
    await store.recordFailure(failure());
    expect((await store.listIssues())[0].status).toBe('open');
  });

  it('isolates issue evidence in non-public schemas', async () => {
    await sql`create schema customer_data`.execute(db);
    for (const statement of computedReliabilitySchemaSql.split(';').filter((part) => part.trim())) {
      await sql
        .raw(
          statement.replace(
            /(TABLE IF NOT EXISTS |ON )(computed_reliability_\w+)/g,
            '$1customer_data.$2'
          )
        )
        .execute(db);
    }
    await sql`create table customer_data.computed_task_field_ref(task_id text,field_id text,table_id text)`.execute(
      db
    );
    const scoped = new PostgresComputedReliabilityStore(db.withSchema('customer_data'));
    await scoped.recordFailure({ ...failure(), targets: [{ tableId: 'table', fieldId: 'field' }] });
    expect(await store.listIssues()).toHaveLength(0);
    expect(await scoped.getFieldSummaries('table', true)).toHaveLength(1);
    expect((await scoped.listIssues())[0].status).toBe('open');
  });
  it('counts distinct issues within authorized fields without returning identity arrays', async () => {
    await store.recordFailure({
      ...failure(),
      targets: [
        { tableId: 'table', fieldId: 'one' },
        { tableId: 'table', fieldId: 'two' },
      ],
    });
    await store.recordFailure({
      ...failure(),
      taskId: 'denied',
      targets: [{ tableId: 'table', fieldId: 'private' }],
    });
    await store.recordFailure({ ...failure(), taskId: 'unknown' });
    expect((await store.getTableSummary('table'))?.unresolvedCount).toBe(3);
    expect(await store.getTableSummary('table', ['one', 'two'])).toMatchObject({
      unresolvedCount: 1,
      scopeComplete: true,
    });
    expect(await store.getTableSummary('table', [])).toEqual({
      unresolvedCount: 0,
      oldestUnresolvedAt: null,
      scopeComplete: true,
    });
    expect(
      (await store.getFieldSummaries('table')).every((field) => !('issueIdentities' in field))
    ).toBe(true);
    expect(await store.getTableSummary('different-table')).toEqual({
      unresolvedCount: 0,
      oldestUnresolvedAt: null,
      scopeComplete: true,
    });
  });
});
