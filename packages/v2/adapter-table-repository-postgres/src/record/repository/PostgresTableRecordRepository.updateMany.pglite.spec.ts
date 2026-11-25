/* eslint-disable require-yield */
import { PGlite } from '@electric-sql/pglite';
import { PostgresUnitOfWorkTransaction } from '@teable/v2-adapter-db-postgres-shared';
import {
  ActorId,
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  LinkFieldConfig,
  RecordByIdsSpec,
  RecordId,
  Table,
  TableId,
  TableName,
  ViewName,
  buildRecordConditionSpec,
  ok,
} from '@teable/v2-core';
import type { IHasher, ILogger, IRecordOrderCalculator } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Dialect, QueryResult } from 'kysely';
import {
  CompiledQuery,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
} from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { installUndoCaptureGlobals } from '../../schema/visitors/__tests__/helpers/installUndoCaptureGlobals';
import type {
  ComputedFieldUpdater,
  ComputedUpdatePlanner,
  IComputedUpdateOutbox,
  IUpdateStrategy,
} from '../computed';
import type { DynamicDB } from '../query-builder';
import { createNoopEventBus } from './__tests__/helpers/createNoopEventBus';
import { PostgresRecordMutationSnapshotCaptureService } from './PostgresRecordMutationSnapshotCaptureService';
import { PostgresTableRecordRepository } from './PostgresTableRecordRepository';

class PGliteDriver {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  async acquireConnection() {
    return new PGliteConnection(this.#client);
  }

  async beginTransaction(connection: PGliteConnection) {
    await connection.executeQuery(CompiledQuery.raw('BEGIN'));
  }

  async commitTransaction(connection: PGliteConnection) {
    await connection.executeQuery(CompiledQuery.raw('COMMIT'));
  }

  async rollbackTransaction(connection: PGliteConnection) {
    await connection.executeQuery(CompiledQuery.raw('ROLLBACK'));
  }

  async destroy() {
    await this.#client.close();
  }

  async init() {}

  async releaseConnection() {}
}

class PGliteConnection {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const result = await this.#client.query<R>(compiledQuery.sql, [...compiledQuery.parameters]);
    return {
      rows: result.rows,
      numAffectedRows: result.affectedRows ? BigInt(result.affectedRows) : undefined,
    };
  }

  async *streamQuery(): AsyncGenerator<never> {
    throw new Error('PGlite does not support streaming.');
  }
}

class KyselyPGliteDialect implements Dialect {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  createAdapter() {
    return new PostgresAdapter();
  }

  createDriver() {
    return new PGliteDriver(this.#client);
  }

  createIntrospector(db: Kysely<unknown>) {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }
}

const sanitizeIdSeed = (seed: string): string => seed.replace(/[^0-9a-z]/gi, '0');
const createId = (prefix: string, seed: string): string =>
  `${prefix}${sanitizeIdSeed(seed).padEnd(16, '0').slice(0, 16)}`;

const createLogger = (): ILogger => {
  const logger: ILogger = {
    child: () => logger,
    scope: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger;
};

const createNoopComputedPlanner = (table: Table): ComputedUpdatePlanner => {
  const plan = {
    baseId: table.baseId(),
    seedTableId: table.id(),
    seedRecordIds: [],
    extraSeedRecords: [],
    steps: [],
    edges: [],
    estimatedComplexity: 0,
    changeType: 'update' as const,
  };
  return {
    plan: async () => ok(plan),
    planStage: async () => ok(plan),
    resolveBeforeImageRequirements: async () =>
      ok({
        needsBeforeImage: false,
        requiredFieldIds: [],
      }),
    hasWritableComputedWork: () => true,
  } as unknown as ComputedUpdatePlanner;
};

const createNoopStrategy = (): IUpdateStrategy => {
  return {
    mode: 'sync',
    name: 'noop',
    execute: async () => ok(undefined),
    scheduleDispatch: () => undefined,
  };
};

const createNoopOutbox = (): IComputedUpdateOutbox => {
  return {
    enqueueOrMerge: async () => ok({ taskId: 'test', merged: false }),
    enqueueSeedTask: async () => ok({ taskId: 'test', merged: false }),
    enqueueFieldBackfill: async () => ok({ taskId: 'test', merged: false }),
    claimBatch: async () => ok([]),
    claimById: async () => ok(null),
    renewLease: async () => ok([]),
    markDone: async () => ok(true),
    markFailed: async () => ok(true),
  };
};

const createNoopHasher = (): IHasher => {
  return {
    sha256: () => 'test-hash',
  };
};

const createNoopRecordOrderCalculator = (): IRecordOrderCalculator => {
  return {
    calculateOrders: async () => ok([]),
  };
};

const createRepository = (db: Kysely<DynamicDB>, table: Table) => {
  const logger = createLogger();
  const computedUpdatePlanner = createNoopComputedPlanner(table);
  const computedFieldUpdater = {} as ComputedFieldUpdater;
  const computedUpdateStrategy = createNoopStrategy();
  const computedUpdateOutbox = createNoopOutbox();
  const hasher = createNoopHasher();

  return new PostgresTableRecordRepository(
    db as unknown as Kysely<V1TeableDatabase>,
    logger,
    createNoopRecordOrderCalculator(),
    computedUpdatePlanner,
    computedFieldUpdater,
    computedUpdateStrategy,
    computedUpdateOutbox,
    new PostgresRecordMutationSnapshotCaptureService(
      db as unknown as Kysely<V1TeableDatabase>,
      logger
    ),
    createNoopEventBus(),
    hasher
  );
};

const createTableWithStorage = async (
  db: Kysely<V1TeableDatabase>,
  seed: string
): Promise<{
  table: Table;
  schemaName: string;
  tableName: string;
  titleFieldId: string;
  amountFieldId: string;
  statusFieldId: string;
}> => {
  const baseId = BaseId.create(createId('bse', seed))._unsafeUnwrap();
  const tableId = TableId.create(createId('tbl', seed))._unsafeUnwrap();

  const builder = Table.builder()
    .withBaseId(baseId)
    .withId(tableId)
    .withName(TableName.create(`UpdateMany-${seed}`)._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.field().number().withName(FieldName.create('Amount')._unsafeUnwrap()).done();
  builder.field().singleLineText().withName(FieldName.create('Status')._unsafeUnwrap()).done();
  builder.view().grid().withName(ViewName.create('Grid')._unsafeUnwrap()).done();
  const table = builder.build()._unsafeUnwrap();

  const [titleField, amountField, statusField] = table.getFields();
  titleField!.setDbFieldName(DbFieldName.rehydrate('col_title')._unsafeUnwrap())._unsafeUnwrap();
  amountField!.setDbFieldName(DbFieldName.rehydrate('col_amount')._unsafeUnwrap())._unsafeUnwrap();
  statusField!.setDbFieldName(DbFieldName.rehydrate('col_status')._unsafeUnwrap())._unsafeUnwrap();

  const schemaName = baseId.toString();
  const tableName = tableId.toString();
  const fullTableName = `${schemaName}.${tableName}`;

  await sql`CREATE SCHEMA ${sql.id(schemaName)}`.execute(db);
  await sql`
    CREATE TABLE ${sql.table(fullTableName)} (
      __id text PRIMARY KEY,
      __created_time timestamptz NOT NULL,
      __created_by text NOT NULL,
      __last_modified_time timestamptz NOT NULL,
      __last_modified_by text NOT NULL,
      __version integer NOT NULL,
      __auto_number serial NOT NULL,
      col_title text,
      col_amount double precision,
      col_status text
    )
  `.execute(db);

  await sql`
    INSERT INTO table_meta (id, last_modified_time, last_modified_by)
    VALUES (${table.id().toString()}, NOW(), 'seed')
    ON CONFLICT (id) DO NOTHING
  `.execute(db);

  return {
    table,
    schemaName,
    tableName,
    titleFieldId: titleField!.id().toString(),
    amountFieldId: amountField!.id().toString(),
    statusFieldId: statusField!.id().toString(),
  };
};

describe('PostgresTableRecordRepository.updateMany (pglite)', () => {
  let pglite: PGlite;
  let db: Kysely<V1TeableDatabase>;
  const createdSchemas: string[] = [];
  const queries: string[] = [];

  beforeAll(async () => {
    pglite = await PGlite.create();
    db = new Kysely<V1TeableDatabase>({
      dialect: new KyselyPGliteDialect(pglite),
      log: (event) => {
        if (event.level === 'query') queries.push(event.query.sql);
      },
    });

    await sql`
      CREATE TABLE IF NOT EXISTS table_meta (
        id text PRIMARY KEY,
        last_modified_time timestamptz,
        last_modified_by text
      )
    `.execute(db);

    await installUndoCaptureGlobals(db);
  });

  afterEach(async () => {
    for (const schemaName of createdSchemas) {
      await sql`DROP SCHEMA IF EXISTS ${sql.id(schemaName)} CASCADE`.execute(db);
    }
    createdSchemas.length = 0;
    queries.length = 0;
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('updates matching rows with a single update-set-where statement', async () => {
    const { table, schemaName, tableName, amountFieldId, statusFieldId } =
      await createTableWithStorage(db, 'update-many');
    createdSchemas.push(schemaName);

    const fullTableName = `${schemaName}.${tableName}`;
    const recordA = createId('rec', 'update-many-a');
    const recordB = createId('rec', 'update-many-b');
    const actorId = ActorId.create('tester')._unsafeUnwrap();

    await sql`
      INSERT INTO ${sql.table(fullTableName)} (
        __id,
        __created_time,
        __created_by,
        __last_modified_time,
        __last_modified_by,
        __version,
        col_title,
        col_amount,
        col_status
      )
      VALUES
        (
          ${recordA},
          NOW(),
          'seed',
          NOW(),
          'seed',
          1,
          'Low',
          2,
          'Open'
        ),
        (
          ${recordB},
          NOW(),
          'seed',
          NOW(),
          'seed',
          3,
          'High',
          10,
          'Open'
        )
    `.execute(db);

    const filterSpec = buildRecordConditionSpec(table, {
      fieldId: amountFieldId,
      operator: 'isGreater',
      value: 5,
    })._unsafeUnwrap();

    const mutateSpec = table
      .updateRecord(RecordId.create(recordA)._unsafeUnwrap(), new Map([[statusFieldId, 'Done']]))
      ._unsafeUnwrap().mutateSpec;

    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const result = await repository.updateMany({ actorId }, table, filterSpec, mutateSpec);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalUpdated).toBe(1);
    expect(result._unsafeUnwrap().updatedRecordIds.map((recordId) => recordId.toString())).toEqual([
      recordB,
    ]);
    expect(
      result._unsafeUnwrap().updatedRecords.map((record) => ({
        recordId: record.recordId.toString(),
        oldVersion: record.oldVersion,
        newVersion: record.newVersion,
        oldFieldValues: record.oldFieldValues,
      }))
    ).toEqual([
      {
        recordId: recordB,
        oldVersion: 3,
        newVersion: 4,
        oldFieldValues: {
          [statusFieldId]: 'Open',
        },
      },
    ]);

    const rows = await sql<{
      __id: string;
      col_status: string | null;
      __version: number;
      __last_modified_by: string;
    }>`
      SELECT __id, col_status, __version, __last_modified_by
      FROM ${sql.table(fullTableName)}
      ORDER BY __id
    `.execute(db);

    expect(rows.rows).toEqual([
      {
        __id: recordA,
        col_status: 'Open',
        __version: 1,
        __last_modified_by: 'seed',
      },
      {
        __id: recordB,
        col_status: 'Done',
        __version: 4,
        __last_modified_by: 'tester',
      },
    ]);
  });

  it('updates explicit recordIds without touching other rows', async () => {
    const { table, schemaName, tableName, statusFieldId } = await createTableWithStorage(
      db,
      'update-many-ids'
    );
    createdSchemas.push(schemaName);

    const fullTableName = `${schemaName}.${tableName}`;
    const recordA = createId('rec', 'ids-a');
    const recordB = createId('rec', 'ids-b');
    const recordC = createId('rec', 'ids-c');
    const actorId = ActorId.create('tester')._unsafeUnwrap();

    await sql`
      INSERT INTO ${sql.table(fullTableName)} (
        __id,
        __created_time,
        __created_by,
        __last_modified_time,
        __last_modified_by,
        __version,
        col_title,
        col_amount,
        col_status
      )
      VALUES
        (${recordA}, NOW(), 'seed', NOW(), 'seed', 1, 'Alpha', 1, 'Open'),
        (${recordB}, NOW(), 'seed', NOW(), 'seed', 2, 'Beta', 2, 'Open'),
        (${recordC}, NOW(), 'seed', NOW(), 'seed', 3, 'Gamma', 3, 'Open')
    `.execute(db);

    const targetSpec = RecordByIdsSpec.create([
      RecordId.create(recordA)._unsafeUnwrap(),
      RecordId.create(recordC)._unsafeUnwrap(),
    ]);
    const mutateSpec = table
      .updateRecord(RecordId.create(recordA)._unsafeUnwrap(), new Map([[statusFieldId, 'Done']]))
      ._unsafeUnwrap().mutateSpec;

    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const result = await repository.updateMany({ actorId }, table, targetSpec, mutateSpec);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalUpdated).toBe(2);
    expect(result._unsafeUnwrap().updatedRecordIds.map((recordId) => recordId.toString())).toEqual([
      recordA,
      recordC,
    ]);

    const rows = await sql<{
      __id: string;
      col_status: string | null;
      __version: number;
    }>`
      SELECT __id, col_status, __version
      FROM ${sql.table(fullTableName)}
      ORDER BY __id
    `.execute(db);

    expect(rows.rows).toEqual([
      {
        __id: recordA,
        col_status: 'Done',
        __version: 2,
      },
      {
        __id: recordB,
        col_status: 'Open',
        __version: 2,
      },
      {
        __id: recordC,
        col_status: 'Done',
        __version: 4,
      },
    ]);
  });

  it('does not update selector-matched rows when requested values are unchanged', async () => {
    const { table, schemaName, tableName, statusFieldId } = await createTableWithStorage(
      db,
      'update-many-noop'
    );
    createdSchemas.push(schemaName);

    const fullTableName = `${schemaName}.${tableName}`;
    const recordId = createId('rec', 'noop-selector');
    const actorId = ActorId.create('tester')._unsafeUnwrap();

    await sql`
      INSERT INTO ${sql.table(fullTableName)} (
        __id,
        __created_time,
        __created_by,
        __last_modified_time,
        __last_modified_by,
        __version,
        col_title,
        col_amount,
        col_status
      )
      VALUES (${recordId}, NOW(), 'seed', NOW(), 'seed', 1, 'Alpha', 1, 'Open')
    `.execute(db);

    const targetSpec = RecordByIdsSpec.create([RecordId.create(recordId)._unsafeUnwrap()]);
    const mutateSpec = table
      .updateRecord(RecordId.create(recordId)._unsafeUnwrap(), new Map([[statusFieldId, 'Open']]))
      ._unsafeUnwrap().mutateSpec;

    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const result = await repository.updateMany({ actorId }, table, targetSpec, mutateSpec);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      totalUpdated: 0,
      updatedRecordIds: [],
      updatedRecords: [],
    });

    const rows = await sql<{
      __id: string;
      col_status: string | null;
      __version: number;
      __last_modified_by: string;
    }>`
      SELECT __id, col_status, __version, __last_modified_by
      FROM ${sql.table(fullTableName)}
      ORDER BY __id
    `.execute(db);

    expect(rows.rows).toEqual([
      {
        __id: recordId,
        col_status: 'Open',
        __version: 1,
        __last_modified_by: 'seed',
      },
    ]);
  });

  it('does not update explicit stream rows when requested values are unchanged', async () => {
    const { table, schemaName, tableName, statusFieldId } = await createTableWithStorage(
      db,
      'update-stream-noop'
    );
    createdSchemas.push(schemaName);

    const fullTableName = `${schemaName}.${tableName}`;
    const recordId = createId('rec', 'noop-stream');
    const actorId = ActorId.create('tester')._unsafeUnwrap();
    const typedRecordId = RecordId.create(recordId)._unsafeUnwrap();

    await sql`
      INSERT INTO ${sql.table(fullTableName)} (
        __id,
        __created_time,
        __created_by,
        __last_modified_time,
        __last_modified_by,
        __version,
        col_title,
        col_amount,
        col_status
      )
      VALUES (${recordId}, NOW(), 'seed', NOW(), 'seed', 1, 'Alpha', 1, 'Open')
    `.execute(db);

    const updateResult = table
      .updateRecord(typedRecordId, new Map([[statusFieldId, 'Open']]))
      ._unsafeUnwrap();
    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const result = await repository.updateManyStream(
      { actorId },
      table,
      (function* () {
        yield ok([updateResult]);
      })()
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({ totalUpdated: 0, updatedRecords: [] });
    expect(result._unsafeUnwrap().recordActorsByRecord?.get(recordId)).toEqual({
      createdByActorType: null,
      createdByActorId: null,
      lastModifiedByActorType: null,
      lastModifiedByActorId: null,
    });

    const rows = await sql<{
      __id: string;
      col_status: string | null;
      __version: number;
      __last_modified_by: string;
    }>`
      SELECT __id, col_status, __version, __last_modified_by
      FROM ${sql.table(fullTableName)}
      ORDER BY __id
    `.execute(db);

    expect(rows.rows).toEqual([
      {
        __id: recordId,
        col_status: 'Open',
        __version: 1,
        __last_modified_by: 'seed',
      },
    ]);
  });

  it('replaces two junctions in four statements for 250 changed source rows', async () => {
    const targets = await createTableWithStorage(db, 'junction-targets');
    createdSchemas.push(targets.schemaName);
    const targetTableName = `${targets.schemaName}.${targets.tableName}`;
    const { table: sourceFixture, schemaName, tableName } = await createTableWithStorage(
      db,
      'junction-sources'
    );
    createdSchemas.push(schemaName);
    const sourceTableName = `${schemaName}.${tableName}`;
    const builder = Table.builder()
      .withBaseId(sourceFixture.baseId())
      .withId(sourceFixture.id())
      .withName(sourceFixture.name());
    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();

    const [retained, removed, added] = ['retained', 'removed', 'added'].map((title) => ({
      id: createId('rec', title),
      title,
    }));
    const initial = [retained, removed];
    const replacement = [added, retained];
    const links = ['a', 'b'].map((suffix) => ({
      fieldId: createId('fld', `link-${suffix}`),
      column: `col_link_${suffix}`,
      junction: `${schemaName}.junction_${suffix}`,
      isOneWay: suffix === 'a',
    }));
    for (const link of links) {
      builder
        .field()
        .link()
        .withId(FieldId.create(link.fieldId)._unsafeUnwrap())
        .withName(FieldName.create(link.column)._unsafeUnwrap())
        .withConfig(
          LinkFieldConfig.create({
            relationship: 'manyMany',
            foreignTableId: targets.table.id().toString(),
            lookupFieldId: targets.titleFieldId,
            fkHostTableName: link.junction,
            selfKeyName: 'source_id',
            foreignKeyName: 'target_id',
            isOneWay: link.isOneWay,
          })._unsafeUnwrap()
        )
        .done();
    }
    const table = builder.view().defaultGrid().done().build()._unsafeUnwrap();
    const [title, ...linkFields] = table.getFields();
    title.setDbFieldName(DbFieldName.rehydrate('col_title')._unsafeUnwrap())._unsafeUnwrap();
    for (const [index, field] of linkFields.entries()) {
      field.setDbFieldName(DbFieldName.rehydrate(links[index].column)._unsafeUnwrap())._unsafeUnwrap();
    }

    const recordIds = Array.from({ length: 252 }, (_, i) =>
      createId('rec', `source-${i.toString().padStart(3, '0')}`)
    );
    const noopId = recordIds[250];
    const existingIds = recordIds.slice(0, 251);
    await sql`
      insert into ${sql.table(targetTableName)}
        (__id, __created_time, __created_by, __last_modified_time, __last_modified_by, __version)
      select id, now(), 'seed', now(), 'seed', 1
      from unnest(${[retained.id, removed.id, added.id]}::text[]) as ids(id)
    `.execute(db);
    await sql`
      insert into ${sql.table(sourceTableName)}
        (__id, __created_time, __created_by, __last_modified_time, __last_modified_by, __version)
      select id, now(), 'seed', now(), 'seed', 1
      from unnest(${existingIds}::text[]) as ids(id)
    `.execute(db);

    const getNoopEdges = (junction: string) =>
      sql<{ id: number }>`
        select id from ${sql.table(junction)} where source_id = ${noopId} order by id
      `.execute(db);
    const originalNoopEdges = [];
    for (const link of links) {
      await sql`
        alter table ${sql.table(sourceTableName)} add column ${sql.id(link.column)} jsonb
      `.execute(db);
      await sql`
        update ${sql.table(sourceTableName)} set ${sql.id(link.column)} = ${JSON.stringify(initial)}::jsonb
      `.execute(db);
      await sql`
        create table ${sql.table(link.junction)} (
          id serial primary key,
          source_id text references ${sql.table(sourceTableName)} (__id),
          target_id text references ${sql.table(targetTableName)} (__id),
          __order integer not null,
          unique (source_id, target_id)
        )
      `.execute(db);
      await sql`
        insert into ${sql.table(link.junction)} (source_id, target_id, __order)
        select id, edge.target_id, edge.position
        from unnest(${existingIds}::text[]) as ids(id)
        cross join (values (${retained.id}::text, 1), (${removed.id}::text, 2)) as edge(target_id, position)
      `.execute(db);
      originalNoopEdges.push((await getNoopEdges(link.junction)).rows);
    }

    const updates = recordIds.map((id, index) =>
      table
        .updateRecord(
          RecordId.create(id)._unsafeUnwrap(),
          new Map([
            [links[0].fieldId, id === noopId ? initial : replacement],
            [links[1].fieldId, id === noopId ? initial : index < 125 ? null : replacement],
          ])
        )
        ._unsafeUnwrap()
    );
    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const writeStart = queries.length;
    const result = await db.transaction().execute((trx) =>
      repository.updateManyStream(
        {
          actorId: ActorId.create('tester')._unsafeUnwrap(),
          transaction: new PostgresUnitOfWorkTransaction(trx, 'data'),
        },
        table,
        (function* () {
          yield ok(updates);
        })(),
        { skipComputedUpdates: true }
      )
    );
    expect(result._unsafeUnwrap().totalUpdated).toBe(250);
    const junctionWrites = queries.slice(writeStart).filter(
      (query) => /^(delete from|insert into)\b/i.test(query) && /"junction_[ab]"/.test(query)
    );
    expect(junctionWrites).toHaveLength(4);

    for (const [index, link] of links.entries()) {
      expect((await getNoopEdges(link.junction)).rows).toEqual(originalNoopEdges[index]);
      const { rows } = await sql<{ source_id: string; targets: string[] }>`
        select source_id, array_agg(target_id order by __order) as targets
        from ${sql.table(link.junction)}
        group by source_id
      `.execute(db);
      const bySource = new Map(rows.map((row) => [row.source_id, row.targets]));
      expect(bySource.size).toBe(index === 0 ? 251 : 126);
      for (const [sourceIndex, sourceId] of existingIds.entries()) {
        const expected =
          sourceId === noopId
            ? [retained.id, removed.id]
            : index === 1 && sourceIndex < 125
              ? undefined
              : [added.id, retained.id];
        expect(bySource.get(sourceId)).toEqual(expected);
      }
    }
  });
});
