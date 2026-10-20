import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import {
  ActorId,
  BaseId,
  buildRecordConditionSpec,
  DefaultTableMapper,
  FieldId,
  TableId,
  type ITablePersistenceDTO,
} from '@teable/v2-core';
import { DataQueryDefinition, projectExplainPlanDocument } from '@teable/v2-data-query';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  CompiledQuery,
  PostgresDialect,
  sql,
  Kysely,
  type PostgresPool,
  type PostgresPoolClient,
  type QueryExecutor,
} from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresDataQueryExecutor } from './PostgresDataQueryExecutor';
import { PostgresDataQueryExplainer } from './PostgresDataQueryExplainer';

const describePg = process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1' ? describe : describe.skip;
const baseId = BaseId.create(`bse${'x'.repeat(16)}`)._unsafeUnwrap();
const tableId = TableId.create(`tbl${'x'.repeat(16)}`)._unsafeUnwrap();
const titleId = FieldId.create(`fld${'x'.repeat(16)}`)._unsafeUnwrap();
const context = { actorId: ActorId.create('explain-actor')._unsafeUnwrap() };
const bindSentinel = 'BIND_SENTINEL_T7974_5f19b1';
const storedSentinel = 'STORED_SENTINEL_T7974_5f19b1';

const dto: ITablePersistenceDTO = {
  id: tableId.toString(),
  baseId: baseId.toString(),
  name: 'Explain table',
  dbTableName: `${baseId.toString()}.explain_records`,
  primaryFieldId: titleId.toString(),
  fields: [
    {
      id: titleId.toString(),
      name: 'Title',
      type: 'singleLineText',
      dbFieldName: 'title',
      isPrimary: true,
    },
  ],
  views: [{ id: `viw${'x'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
};

type ExplainRow = { 'QUERY PLAN': unknown };

type CapturedStatement = {
  readonly level: 'query' | 'error';
  readonly sql: string;
  readonly parameters: ReadonlyArray<unknown>;
};

const isExplain = (statement: CapturedStatement): boolean => /^\s*explain\b/i.test(statement.sql);

/** A business read is any non-EXPLAIN statement that reads the inspected relation. */
const isBusinessRead = (statement: CapturedStatement, relation: string): boolean =>
  !isExplain(statement) &&
  /\bfrom\b/i.test(statement.sql) &&
  statement.sql.toLowerCase().includes(relation.toLowerCase());

const businessReads = (
  captured: ReadonlyArray<CapturedStatement>,
  relation: string
): CapturedStatement[] => captured.filter((statement) => isBusinessRead(statement, relation));

/**
 * Kysely attaches its log callback only when the instance is constructed, and
 * createV2PostgresDb does not expose that option. This second Kysely borrows
 * one real connection from the first instance's public query executor and lets
 * Kysely log every compiled statement as it runs, including
 * transaction.executeQuery of the EXPLAIN and its exact parameter array.
 */
const createCapturingDb = (executor: QueryExecutor, captured: CapturedStatement[]) => {
  const clients = new Set<{ release: () => void }>();
  const pool: PostgresPool = {
    connect: () =>
      new Promise<PostgresPoolClient>((resolve, reject) => {
        void executor
          .provideConnection(async (connection) => {
            let release!: () => void;
            const released = new Promise<void>((done) => {
              release = done;
            });
            const client = {
              query: async (text: string, parameters?: ReadonlyArray<unknown>) => {
                const result = await connection.executeQuery(
                  CompiledQuery.raw(text, [...(parameters ?? [])])
                );
                return {
                  command: 'SELECT' as const,
                  rowCount: result.rows.length,
                  rows: result.rows,
                };
              },
              release,
            };
            clients.add(client);
            resolve(client as unknown as PostgresPoolClient);
            await released;
          })
          .catch(reject);
      }),
    end: async () => {
      for (const client of clients) client.release();
      clients.clear();
    },
  };
  return new Kysely<V1TeableDatabase>({
    dialect: new PostgresDialect({ pool }),
    log: (event) => {
      captured.push({
        level: event.level,
        sql: event.query.sql,
        parameters: [...event.query.parameters],
      });
    },
  });
};

const scanRows = (plan: unknown): number | undefined => {
  const node = plan as { nodeType?: string; planRows?: number; children?: unknown[] };
  if (node.nodeType === 'Seq Scan') return node.planRows;
  for (const child of node.children ?? []) {
    const found = scanRows(child);
    if (found !== undefined) return found;
  }
  return undefined;
};

const customPlanRows = async (
  db: Kysely<V1TeableDatabase>,
  compiled: CompiledQuery<Record<string, unknown>>
): Promise<number | undefined> => {
  const result = await db.executeQuery<ExplainRow>(
    CompiledQuery.raw(`explain (format json) ${compiled.sql}`, [...compiled.parameters])
  );
  return scanRows(projectExplainPlanDocument(result.rows[0]?.['QUERY PLAN'], 'generic').root);
};

describePg('PostgresDataQueryExplainer (Postgres)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let connectionString: string;
  let db: Kysely<V1TeableDatabase>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(
      process.env.TEABLE_V2_TEST_PG_IMAGE ?? 'postgres:16-alpine'
    ).start();
    connectionString = container.getConnectionUri();
    db = await createV2PostgresDb<V1TeableDatabase>({
      pg: { connectionString, pool: { max: 1 } },
    });
    await sql`create schema ${sql.id(baseId.toString())}`.execute(db);
    const physical = sql.id(baseId.toString(), 'explain_records');
    await sql`create table ${physical} (__id text, title text)`.execute(db);
    await sql`insert into ${physical} values ('a', ${storedSentinel})`.execute(db);
    await sql`insert into ${physical} select 'c' || value, 'common' from generate_series(1, 100) as value`.execute(
      db
    );
    await sql`insert into ${physical} values ('r', 'rare')`.execute(db);
    // Statistics make the custom plans value-sensitive; without ANALYZE both
    // custom and generic estimates fall back to the same defaults.
    await sql`analyze ${physical}`.execute(db);
    await sql`create table ${sql.id(baseId.toString(), 'explain_probe_audit')} (id serial primary key)`.execute(
      db
    );
    await sql`create function ${sql.id(baseId.toString(), 'explain_probe_bump')}() returns int language sql as 'insert into ${sql.raw(
      `${baseId.toString()}.explain_probe_audit`
    )}(id) values (default) returning 1'`.execute(db);
    // The compiler always appends ORDER BY t.__id, so the probe must expose it
    // or planning fails before any no-execution claim can be made.
    await sql`create view ${sql.id(baseId.toString(), 'explain_probe')} as select __id as __id, ${sql.id(
      baseId.toString(),
      'explain_probe_bump'
    )}() as probe, title as title from ${physical}`.execute(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await container?.stop();
  });

  it('returns caller-scoped SQL and a generic plan without bind values, predicates or rows', async () => {
    const table = new DefaultTableMapper().toDomain(dto)._unsafeUnwrap();
    const definition = DataQueryDefinition.create({
      version: 1,
      kind: 'records',
      tableId: tableId.toString(),
      parameters: { needle: { type: 'string' } },
      select: [{ fieldId: titleId.toString(), alias: 'title' }],
      filter: {
        fieldId: titleId.toString(),
        operator: 'is',
        value: { type: 'parameter', name: 'needle' },
      },
      page: { limit: 10 },
    })._unsafeUnwrap();
    const query = definition.bind({ needle: bindSentinel })._unsafeUnwrap();
    const visibleWhen = buildRecordConditionSpec(table, {
      fieldId: titleId.toString(),
      operator: 'contains',
      value: 'restricted-policy-token',
    })._unsafeUnwrap();
    const captured: CapturedStatement[] = [];
    const capturingDb = createCapturingDb(db.getExecutor(), captured);
    const value = (
      await new PostgresDataQueryExplainer(capturingDb).explain(context, table, query, {
        fieldMasks: [{ fieldId: titleId.toString(), visibleWhen }],
      })
    )._unsafeUnwrap();

    expect(value.sqlScope).toBe('caller');
    expect(value.sql).toContain('$1');
    expect(value.parameters).toMatchObject({
      order: ['needle'],
      orderKind: 'declaration',
      redaction: 'bind-values-hidden',
      definitions: [{ name: 'needle', type: 'string', nullable: false }],
    });
    expect(value.parameters.bindCount).toBeGreaterThan(0);
    expect(value.hostScope).toEqual({
      rowScope: 'applied',
      fieldScope: 'applied',
      fieldMaskCount: 1,
    });
    expect(value.plan.analyzed).toBe(false);
    expect(value.plan.mode).toBe('generic');
    expect(value.plan.scope).toBe('caller');
    expect(value.plan.root?.nodeType).toBeTruthy();

    // Exactly one statement is EXPLAINed, and that EXPLAIN carries no bind
    // parameters: generic planning is value-independent by construction.
    const explains = captured.filter(isExplain);
    expect(explains).toHaveLength(1);
    expect(explains[0]?.sql.toLowerCase()).toContain('explain_records');
    expect(explains[0]?.parameters).toEqual([]);
    expect(businessReads(captured, 'explain_records')).toHaveLength(0);
    const sentinelObserved = captured.some(
      (statement) =>
        statement.sql.includes(bindSentinel) || statement.parameters.includes(bindSentinel)
    );
    expect(sentinelObserved).toBe(false);

    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain(bindSentinel);
    expect(serialized).not.toContain(storedSentinel);
    expect(serialized).not.toContain('restricted-policy-token');
    expect(serialized).not.toContain('Filter');
    expect(serialized).not.toContain('Index Cond');
    expect(serialized).not.toContain('Relation Name');
    expect(value).not.toHaveProperty('rows');
  });

  it('plans the side-effecting view without executing its SELECT', async () => {
    const probeDto: ITablePersistenceDTO = {
      id: `tbl${'p'.repeat(16)}`,
      baseId: baseId.toString(),
      name: 'Explain probe',
      dbTableName: `${baseId.toString()}.explain_probe`,
      primaryFieldId: `fld${'p'.repeat(16)}`,
      fields: [
        {
          id: `fld${'p'.repeat(16)}`,
          name: 'Probe',
          type: 'singleLineText',
          dbFieldName: 'probe',
          isPrimary: true,
        },
        {
          id: `fld${'q'.repeat(16)}`,
          name: 'Title',
          type: 'singleLineText',
          dbFieldName: 'title',
        },
      ],
      views: [{ id: `viw${'p'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
    };
    const table = new DefaultTableMapper().toDomain(probeDto)._unsafeUnwrap();
    const query = DataQueryDefinition.create({
      version: 1,
      kind: 'records',
      tableId: probeDto.id,
      select: [
        { fieldId: `fld${'p'.repeat(16)}`, alias: 'probe' },
        { fieldId: `fld${'q'.repeat(16)}`, alias: 'title' },
      ],
      page: { limit: 10 },
    })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    const captured: CapturedStatement[] = [];
    const capturingDb = createCapturingDb(db.getExecutor(), captured);
    const value = (
      await new PostgresDataQueryExplainer(capturingDb).explain(context, table, query, {})
    )._unsafeUnwrap();

    // A real plan, not the "unavailable" fallback that would also produce no rows.
    expect(value.plan.mode).toBe('generic');
    expect(value.plan.analyzed).toBe(false);
    expect(value.plan.root).toBeDefined();
    expect(value.plan.root?.nodeType).toBeTruthy();

    // The SELECT itself never reached PostgreSQL outside an EXPLAIN.
    const explains = captured.filter(isExplain);
    expect(explains).toHaveLength(1);
    expect(explains[0]?.sql.toLowerCase()).toContain('explain_probe');
    expect(businessReads(captured, 'explain_probe')).toHaveLength(0);

    // And the view's writing function never ran.
    const audit = await sql<{ count: string }>`
      select count(*)::text as count from ${sql.id(baseId.toString(), 'explain_probe_audit')}
    `.execute(db);
    expect(audit.rows[0].count).toBe('0');
  });

  it('captures an executed business SELECT as a positive control', async () => {
    const table = new DefaultTableMapper().toDomain(dto)._unsafeUnwrap();
    const query = DataQueryDefinition.create({
      version: 1,
      kind: 'records',
      tableId: tableId.toString(),
      parameters: { needle: { type: 'string' } },
      select: [{ fieldId: titleId.toString(), alias: 'title' }],
      filter: {
        fieldId: titleId.toString(),
        operator: 'is',
        value: { type: 'parameter', name: 'needle' },
      },
      page: { limit: 10 },
    })
      ._unsafeUnwrap()
      .bind({ needle: bindSentinel })
      ._unsafeUnwrap();
    const captured: CapturedStatement[] = [];
    const capturingDb = createCapturingDb(db.getExecutor(), captured);
    const control = await new PostgresDataQueryExecutor(capturingDb).execute(
      context,
      table,
      query,
      {}
    );
    control._unsafeUnwrap();

    // Capture is proven from the statements alone, not from the response rows.
    const reads = businessReads(captured, 'explain_records');
    expect(reads).toHaveLength(1);
    expect(reads[0]?.sql.toLowerCase()).toMatch(/\bselect\b/);
    expect(reads[0]?.parameters.includes(bindSentinel)).toBe(true);
    expect(captured.filter(isExplain)).toHaveLength(0);
  });

  it('keeps generic-plan estimates independent of bound values', async () => {
    const table = new DefaultTableMapper().toDomain(dto)._unsafeUnwrap();
    const definition = () =>
      DataQueryDefinition.create({
        version: 1,
        kind: 'records',
        tableId: tableId.toString(),
        parameters: { needle: { type: 'string' } },
        select: [{ fieldId: titleId.toString(), alias: 'title' }],
        filter: {
          fieldId: titleId.toString(),
          operator: 'is',
          value: { type: 'parameter', name: 'needle' },
        },
        page: { limit: 10 },
      })._unsafeUnwrap();
    const query = (needle: string) => definition().bind({ needle })._unsafeUnwrap();

    // With real statistics, custom plans must distinguish the frequent and the
    // rare bound value; otherwise "generic equals generic" would be vacuous.
    const executor = new PostgresDataQueryExecutor(db);
    const customCommon = await customPlanRows(
      db,
      executor.compile(context, table, query('common'), {})._unsafeUnwrap()
    );
    const customRare = await customPlanRows(
      db,
      executor.compile(context, table, query('rare'), {})._unsafeUnwrap()
    );
    expect(Number.isFinite(customCommon)).toBe(true);
    expect(Number.isFinite(customRare)).toBe(true);
    expect(customCommon).not.toBe(customRare);

    const captured: CapturedStatement[] = [];
    const capturingDb = createCapturingDb(db.getExecutor(), captured);
    const explainer = new PostgresDataQueryExplainer(capturingDb);
    const common = (await explainer.explain(context, table, query('common'), {}))._unsafeUnwrap();
    const rare = (await explainer.explain(context, table, query('rare'), {}))._unsafeUnwrap();

    expect(common.plan.mode).toBe('generic');
    expect(rare.plan.mode).toBe('generic');
    expect(common.plan.root).toBeDefined();
    expect(rare.plan.root).toBeDefined();

    const genericCommon = scanRows(common.plan.root);
    const genericRare = scanRows(rare.plan.root);
    expect(Number.isFinite(genericCommon)).toBe(true);
    expect(Number.isFinite(genericRare)).toBe(true);
    expect(genericCommon).toBe(genericRare);
    expect(common.plan.root).toEqual(rare.plan.root);

    // PG16 generic planning is proven by the statement log: every EXPLAIN was
    // sent with an empty parameter array, so no bound value reached planning.
    const explains = captured.filter(isExplain);
    expect(explains).toHaveLength(2);
    for (const statement of explains) expect(statement.parameters).toEqual([]);
    const valueObserved = captured.some((statement) =>
      statement.parameters.some((parameter) => parameter === 'common' || parameter === 'rare')
    );
    expect(valueObserved).toBe(false);
  });

  it('reports the shared timeout error class when planning is blocked by a lock', async () => {
    const table = new DefaultTableMapper().toDomain(dto)._unsafeUnwrap();
    const query = DataQueryDefinition.create({
      version: 1,
      kind: 'records',
      tableId: tableId.toString(),
      select: [{ fieldId: titleId.toString(), alias: 'title' }],
      page: { limit: 10 },
    })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    const physical = sql.id(baseId.toString(), 'explain_records');
    const blocker = await createV2PostgresDb<V1TeableDatabase>({
      pg: { connectionString, pool: { max: 1 } },
    });
    let releaseLock!: () => void;
    const lockedUntilReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let acquired!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    // EXPLAIN needs ACCESS SHARE, so an ACCESS EXCLUSIVE holder guarantees the
    // planner blocks until statement_timeout fires; a fast query cannot pass.
    const lockHolder = blocker.transaction().execute(async (transaction) => {
      await sql`lock table ${physical} in access exclusive mode`.execute(transaction);
      acquired();
      await lockedUntilReleased;
    });

    try {
      await Promise.race([lockAcquired, lockHolder]);
      const captured: CapturedStatement[] = [];
      const capturingDb = createCapturingDb(db.getExecutor(), captured);
      const result = await new PostgresDataQueryExplainer(capturingDb, {
        statementTimeoutMs: 50,
      }).explain(context, table, query, {});

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('data_query.timeout');
        expect(result.error.details?.sqlState).toBe('57014');
      }
      // The blocked statement is the EXPLAIN itself, observed at the driver.
      expect(
        captured.some((statement) => statement.level === 'error' && isExplain(statement))
      ).toBe(true);
    } finally {
      releaseLock();
      await lockHolder.catch(() => undefined);
      await blocker.destroy();
    }
  });
});
