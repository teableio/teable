import {
  ActorId,
  BaseId,
  DbFieldName,
  DefaultTableMapper,
  FieldName,
  type IHasher,
  type ILogger,
  type IRecordOrderCalculator,
  RecordId,
  Table,
  TableId,
  TableName,
  TableRecord,
  ViewName,
  ok,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Kysely, sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  createPGliteDb,
  PGliteDialect,
} from '../../schema/visitors/__tests__/helpers/createPGliteDb';
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

const createNoopComputedPlanner = (
  table: Table,
  onPlan?: (input: Record<string, unknown>) => void
): ComputedUpdatePlanner =>
  ({
    plan: async () =>
      ok({
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: [],
        extraSeedRecords: [],
        steps: [],
        edges: [],
        estimatedComplexity: 0,
        changeType: 'delete',
      }),
    planStage: async (input: Record<string, unknown>) => {
      onPlan?.(input);
      return ok({
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: [],
        extraSeedRecords: [],
        steps: [],
        edges: [],
        estimatedComplexity: 0,
        changeType: 'delete',
      });
    },
    resolveBeforeImageRequirements: async () =>
      ok({
        needsBeforeImage: false,
        requiredFieldIds: [],
      }),
    hasWritableComputedWork: () => true,
  }) as unknown as ComputedUpdatePlanner;

const createNoopStrategy = (): IUpdateStrategy => ({
  mode: 'sync',
  name: 'noop',
  execute: async () => ok(undefined),
  scheduleDispatch: () => undefined,
});

const createNoopOutbox = (): IComputedUpdateOutbox =>
  ({
    enqueueOrMerge: async () => ok({ taskId: 'test', merged: false }),
    enqueueSeedTask: async () => ok({ taskId: 'test', merged: false }),
    enqueueFieldBackfill: async () => ok({ taskId: 'test', merged: false }),
    claimBatch: async () => ok([]),
    claimById: async () => ok(null),
    renewLease: async () => ok([]),
    markDone: async () => ok(true),
    markFailed: async () => ok(true),
  }) as IComputedUpdateOutbox;
const createNoopHasher = (): IHasher => ({
  sha256: () => 'test-hash',
});

const createNoopRecordOrderCalculator = (): IRecordOrderCalculator => ({
  calculateOrders: async () => ok([]),
});

const createRepository = (
  db: Kysely<DynamicDB>,
  table: Table,
  onPlan?: (input: Record<string, unknown>) => void
) => {
  const logger = createLogger();
  return new PostgresTableRecordRepository(
    db as unknown as Kysely<V1TeableDatabase>,
    logger,
    createNoopRecordOrderCalculator(),
    createNoopComputedPlanner(table, onPlan),
    {} as ComputedFieldUpdater,
    createNoopStrategy(),
    createNoopOutbox(),
    new PostgresRecordMutationSnapshotCaptureService(
      db as unknown as Kysely<V1TeableDatabase>,
      logger
    ),
    createNoopEventBus(),
    createNoopHasher()
  );
};

describe('PostgresTableRecordRepository.delete (pglite)', () => {
  let db: Kysely<V1TeableDatabase>;
  let destroyDb: (() => Promise<void>) | undefined;
  const createdSchemas: string[] = [];
  const queries: string[] = [];

  beforeAll(async () => {
    const pgliteDb = await createPGliteDb();
    db = new Kysely<V1TeableDatabase>({
      dialect: new PGliteDialect(pgliteDb.pglite),
      log: (event) => {
        queries.push(event.query.sql);
      },
    });
    destroyDb = async () => {
      await db.destroy();
    };

    await sql`
      CREATE TABLE IF NOT EXISTS table_meta (
        id text PRIMARY KEY,
        name text,
        base_id text,
        deleted_time timestamptz,
        last_modified_time timestamptz,
        last_modified_by text
      )
    `.execute(db);
    await sql`
      CREATE TABLE IF NOT EXISTS field (
        id text PRIMARY KEY,
        table_id text,
        name text,
        not_null boolean,
        db_field_name text,
        deleted_time timestamptz,
        type text,
        is_lookup boolean,
        options text
      )
    `.execute(db);
    await installUndoCaptureGlobals(db as never);
  });

  afterEach(async () => {
    for (const schemaName of createdSchemas) {
      await sql`DROP SCHEMA IF EXISTS ${sql.id(schemaName)} CASCADE`.execute(db);
    }
    createdSchemas.length = 0;
    await sql`DELETE FROM field`.execute(db);
    await sql`DELETE FROM table_meta`.execute(db);
  });

  afterAll(async () => {
    await destroyDb?.();
  });

  it.each([1, 2])(
    'captures 54 reverse FK columns from locked rows when deleting %i records',
    async (deleteCount) => {
      const schemaName = createId('bse', `reverse-${deleteCount}`);
      const targetTableId = createId('tbl', 'reverse-target');
      const parentTableIds = [createId('tbl', 'parent-a'), createId('tbl', 'parent-b')];
      const rowIds = ['first', 'second', 'survivor'].map((name) => createId('rec', name));
      const columns = Array.from({ length: 54 }, (_, index) => `__fk_reverse_${index}`);
      const rowValues = rowIds.map((_, rowIndex) =>
        columns.map((__, columnIndex) =>
          (rowIndex + columnIndex) % 5 === 0
            ? null
            : createId('rec', `p${columnIndex % 2}g${Math.floor(columnIndex / 4)}r${rowIndex}`)
        )
      );
      createdSchemas.push(schemaName);

      const builder = Table.builder()
        .withBaseId(BaseId.create(schemaName)._unsafeUnwrap())
        .withId(TableId.create(targetTableId)._unsafeUnwrap())
        .withName(TableName.create('Target')._unsafeUnwrap());
      builder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .primary()
        .done();
      builder.view().grid().withName(ViewName.create('Grid')._unsafeUnwrap()).done();
      const table = builder.build()._unsafeUnwrap();
      table
        .getFields()[0]!
        .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
        ._unsafeUnwrap();

      await sql`CREATE SCHEMA ${sql.id(schemaName)}`.execute(db);
      await sql`
        CREATE TABLE ${sql.id(schemaName)}.${sql.id(targetTableId)} (
          __id text PRIMARY KEY,
          __created_time timestamptz NOT NULL,
          __created_by text NOT NULL,
          __last_modified_time timestamptz NOT NULL,
          __last_modified_by text NOT NULL,
          __version integer NOT NULL,
          __auto_number serial NOT NULL,
          col_name text,
          ${sql.join(columns.map((column) => sql`${sql.id(column)} text`))}
        )
      `.execute(db);
      for (const [rowIndex, rowId] of rowIds.entries()) {
        await sql`
          INSERT INTO ${sql.id(schemaName)}.${sql.id(targetTableId)}
            (__id, __created_time, __created_by, __last_modified_time, __last_modified_by, __version, col_name,
             ${sql.join(columns.map((column) => sql.id(column)))})
          VALUES (${rowId}, NOW(), 'tester', NOW(), 'tester', 1, ${`row-${rowIndex}`},
                  ${sql.join(rowValues[rowIndex]!.map((value) => sql`${value}`))})
        `.execute(db);
      }
      for (const parentTableId of parentTableIds) {
        await sql`
          INSERT INTO table_meta (id, name, base_id, last_modified_time, last_modified_by)
          VALUES (${parentTableId}, 'Parent', ${schemaName}, NOW(), 'seed')
        `.execute(db);
      }
      await sql`
        INSERT INTO table_meta (id, name, base_id, last_modified_time, last_modified_by)
        VALUES (${targetTableId}, 'Target', ${schemaName}, NOW(), 'seed')
      `.execute(db);
      for (const [index, column] of columns.entries()) {
        const fieldId = createId('fld', `reverse${String(index).padStart(2, '0')}`);
        await sql`
          INSERT INTO field (id, table_id, name, not_null, db_field_name, type, is_lookup, options)
          VALUES (${fieldId}, ${parentTableIds[index % 2]}, ${`Link ${index}`}, false, ${`link_${index}`}, 'link', false,
            ${JSON.stringify({
              relationship: 'oneMany',
              isOneWay: false,
              foreignTableId: targetTableId,
              fkHostTableName: `${schemaName}.${targetTableId}`,
              selfKeyName: column,
              foreignKeyName: '__id',
            })})
        `.execute(db);
      }

      const planInputs: Record<string, unknown>[] = [];
      const actorId = ActorId.create('tester')._unsafeUnwrap();
      const specBuilder = TableRecord.specs('or');
      for (const rowId of rowIds.slice(0, deleteCount)) {
        specBuilder.recordId(RecordId.create(rowId)._unsafeUnwrap());
      }
      queries.length = 0;
      const result = await db.transaction().execute(async (trx) => {
        const repository = createRepository(trx as unknown as Kysely<DynamicDB>, table, (input) =>
          planInputs.push(input)
        );
        return repository.deleteMany({ actorId }, table, specBuilder.build()._unsafeUnwrap());
      });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().deletedCount).toBe(deleteCount);

      const seeds = planInputs[0]?.extraSeedRecords as Array<{
        tableId: TableId;
        recordIds: RecordId[];
      }>;
      const actualSeeds = Object.fromEntries(
        seeds.map((group) => [
          group.tableId.toString(),
          group.recordIds.map((id) => id.toString()).sort(),
        ])
      );
      const expectedSeeds = Object.fromEntries(
        parentTableIds.map((parentId, parentIndex) => [
          parentId,
          [
            ...new Set(
              rowValues
                .slice(0, deleteCount)
                .flatMap((values) =>
                  values.filter(
                    (value, index): value is string => index % 2 === parentIndex && value !== null
                  )
                )
            ),
          ].sort(),
        ])
      );
      expect(actualSeeds).toEqual(expectedSeeds);

      const hostReads = queries.filter(
        (query) =>
          /^select\b/i.test(query.trim()) &&
          query.includes(`from "${schemaName}"."${targetTableId}"`)
      );
      expect(hostReads).toHaveLength(1);
      expect(hostReads[0]).toMatch(/for update/i);
      const emptySavepoints = queries.filter(
        (query, index) =>
          /^savepoint /i.test(query) &&
          queries[index + 1]?.toLowerCase() === `release ${query.toLowerCase()}`
      );
      expect(emptySavepoints).toEqual([]);

      const remaining = await sql<Record<string, string | null>>`
        SELECT __id, col_name, ${sql.join(columns.map((column) => sql.id(column)))}
        FROM ${sql.id(schemaName)}.${sql.id(targetTableId)} ORDER BY col_name
      `.execute(db);
      expect(remaining.rows).toEqual(
        rowIds.slice(deleteCount).map((rowId, index) => ({
          __id: rowId,
          col_name: `row-${index + deleteCount}`,
          ...Object.fromEntries(
            columns.map((column, columnIndex) => [
              column,
              rowValues[index + deleteCount]![columnIndex],
            ])
          ),
        }))
      );

      // A required reverse link still blocks deletion of its last surviving child.
      await sql`UPDATE field SET not_null = true WHERE id = ${createId('fld', 'reverse00')}`.execute(
        db
      );
      const lastChildSpec = TableRecord.specs('or')
        .recordId(RecordId.create(rowIds[2]!)._unsafeUnwrap())
        .build()
        ._unsafeUnwrap();
      const blocked = await db.transaction().execute(async (trx) => {
        const repository = createRepository(trx as unknown as Kysely<DynamicDB>, table);
        return repository.deleteMany({ actorId }, table, lastChildSpec);
      });
      expect(blocked.isErr()).toBe(true);
      if (blocked.isErr()) expect(blocked.error.code).toBe('validation.field.not_null');
      const survivor = await sql<{ count: string }>`
        SELECT count(*)::text AS count FROM ${sql.id(schemaName)}.${sql.id(targetTableId)}
        WHERE __id = ${rowIds[2]}
      `.execute(db);
      expect(survivor.rows[0]?.count).toBe('1');
    }
  );

  it('deletes records when a deleted incoming link column is already gone', async () => {
    const schemaName = createId('bse', 'del-missing-fk');
    const targetTableId = createId('tbl', 'target-a');
    const sourceTableId = createId('tbl', 'source-b');
    const linkFieldId = createId('fld', 'deleted-link');
    const recordId = createId('rec', 'alive-row');
    createdSchemas.push(schemaName);

    const builder = Table.builder()
      .withBaseId(BaseId.create(schemaName)._unsafeUnwrap())
      .withId(TableId.create(targetTableId)._unsafeUnwrap())
      .withName(TableName.create('Target')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().grid().withName(ViewName.create('Grid')._unsafeUnwrap()).done();
    const table = builder.build()._unsafeUnwrap();
    table
      .getFields()[0]!
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();

    await sql`CREATE SCHEMA ${sql.id(schemaName)}`.execute(db);
    await sql`
      CREATE TABLE ${sql.id(schemaName)}.${sql.id(targetTableId)} (
        __id text PRIMARY KEY,
        __created_time timestamptz NOT NULL,
        __created_by text NOT NULL,
        __last_modified_time timestamptz NOT NULL,
        __last_modified_by text NOT NULL,
        __version integer NOT NULL,
        __auto_number serial NOT NULL,
        col_name text
      )
    `.execute(db);
    await sql`
      CREATE TABLE ${sql.id(schemaName)}.${sql.id(sourceTableId)} (
        __id text PRIMARY KEY,
        __created_time timestamptz NOT NULL,
        __created_by text NOT NULL,
        __last_modified_time timestamptz NOT NULL,
        __last_modified_by text NOT NULL,
        __version integer NOT NULL,
        __auto_number serial NOT NULL
      )
    `.execute(db);

    await sql`
      INSERT INTO ${sql.id(schemaName)}.${sql.id(targetTableId)}
        (__id, __created_time, __created_by, __last_modified_time, __last_modified_by, __version, col_name)
      VALUES (${recordId}, NOW(), 'tester', NOW(), 'tester', 1, 'Alice')
    `.execute(db);

    await sql`
      INSERT INTO table_meta (id, name, base_id, last_modified_time, last_modified_by)
      VALUES
        (${targetTableId}, 'Target', ${schemaName}, NOW(), 'seed'),
        (${sourceTableId}, 'Source', ${schemaName}, NOW(), 'seed')
    `.execute(db);
    await sql`
      INSERT INTO field (id, table_id, name, not_null, db_field_name, type, is_lookup, deleted_time, options)
      VALUES (
        ${linkFieldId},
        ${sourceTableId},
        'DeletedLink',
        false,
        'Link',
        'link',
        false,
        NOW(),
        ${JSON.stringify({
          relationship: 'manyOne',
          isOneWay: false,
          foreignTableId: targetTableId,
          fkHostTableName: `${schemaName}.${sourceTableId}`,
          selfKeyName: '__id',
          foreignKeyName: `__fk_${linkFieldId}`,
        })}
      )
    `.execute(db);

    const repository = createRepository(db as unknown as Kysely<DynamicDB>, table);
    const actorId = ActorId.create('tester')._unsafeUnwrap();
    const deleteSpec = TableRecord.specs('or')
      .recordId(RecordId.create(recordId)._unsafeUnwrap())
      .build()
      ._unsafeUnwrap();

    const result = await repository.deleteMany({ actorId }, table, deleteSpec);
    expect(result.isOk()).toBe(true);

    const remaining = await sql<{ cnt: string }>`
      SELECT count(*)::text AS cnt
      FROM ${sql.id(schemaName)}.${sql.id(targetTableId)}
    `.execute(db);
    expect(remaining.rows[0]?.cnt).toBe('0');

    await sql`SELECT 1`.execute(db);
  });

  it.each(['linked', 'null', 'missing', 'stale'] as const)(
    'reports reverse-link capture only when the FK was readable (%s)',
    async (storage) => {
      const schemaName = createId('bse', `capture-${storage}`);
      const targetTableId = createId('tbl', `child-${storage}`);
      const sourceTableId = createId('tbl', `parent-${storage}`);
      const childFieldId = createId('fld', `child-link-${storage}`);
      const parentFieldId = createId('fld', `parent-link-${storage}`);
      const nameFieldId = createId('fld', `name-${storage}`);
      const parentNameFieldId = createId('fld', `parent-name-${storage}`);
      const recordId = createId('rec', `child-${storage}`);
      const parentId = createId('rec', `parent-${storage}`);
      const secondRecordId = createId('rec', `child2-${storage}`);
      const secondParentId = createId('rec', `parent2-${storage}`);
      const fkName = '__fk_parent';
      const host = `${schemaName}.${targetTableId}`;
      createdSchemas.push(schemaName);

      const table = new DefaultTableMapper()
        .toDomain({
          id: targetTableId,
          baseId: schemaName,
          name: 'Child',
          dbTableName: host,
          primaryFieldId: nameFieldId,
          fields: [
            { id: nameFieldId, name: 'Name', dbFieldName: 'col_name', type: 'singleLineText' },
            {
              id: childFieldId,
              name: 'Parent',
              dbFieldName: 'col_parent',
              type: 'link',
              options: {
                relationship: 'manyOne',
                foreignTableId: sourceTableId,
                lookupFieldId: parentNameFieldId,
                symmetricFieldId: parentFieldId,
                isOneWay: false,
                fkHostTableName: host,
                selfKeyName: '__id',
                foreignKeyName: fkName,
              },
            },
          ],
          views: [
            {
              id: createId('viw', `capture-${storage}`),
              name: 'Grid',
              type: 'grid',
              columnMeta: {},
            },
          ],
        })
        ._unsafeUnwrap();

      await sql`CREATE SCHEMA ${sql.id(schemaName)}`.execute(db);
      await sql`
        CREATE TABLE ${sql.id(schemaName)}.${sql.id(targetTableId)} (
          __id text PRIMARY KEY, __created_time timestamptz NOT NULL, __created_by text NOT NULL,
          __last_modified_time timestamptz NOT NULL, __last_modified_by text NOT NULL,
          __version integer NOT NULL, __auto_number serial NOT NULL, col_name text, col_parent jsonb
        )
      `.execute(db);
      if (storage !== 'missing') {
        await sql`ALTER TABLE ${sql.id(schemaName)}.${sql.id(targetTableId)} ADD COLUMN ${sql.id(fkName)} text`.execute(
          db
        );
      }
      await sql`
        INSERT INTO ${sql.id(schemaName)}.${sql.id(targetTableId)}
          (__id, __created_time, __created_by, __last_modified_time, __last_modified_by, __version, col_name)
        VALUES (${recordId}, NOW(), 'tester', NOW(), 'tester', 1, 'child'),
               (${secondRecordId}, NOW(), 'tester', NOW(), 'tester', 1, 'child 2')
      `.execute(db);
      if (storage === 'linked' || storage === 'stale') {
        await sql`UPDATE ${sql.id(schemaName)}.${sql.id(targetTableId)} SET ${sql.id(fkName)} = ${parentId} WHERE __id = ${recordId}`.execute(
          db
        );
        await sql`UPDATE ${sql.id(schemaName)}.${sql.id(targetTableId)} SET ${sql.id(fkName)} = ${secondParentId} WHERE __id = ${secondRecordId}`.execute(
          db
        );
      }
      await sql`
        INSERT INTO table_meta (id, name, base_id, last_modified_time, last_modified_by)
        VALUES (${targetTableId}, 'Child', ${schemaName}, NOW(), 'seed'),
               (${sourceTableId}, 'Parent', ${schemaName}, NOW(), 'seed')
      `.execute(db);
      await sql`
        INSERT INTO field (id, table_id, name, not_null, db_field_name, type, is_lookup, options)
        VALUES (${parentFieldId}, ${sourceTableId}, 'Children', false, 'children', 'link', false,
          ${JSON.stringify({
            relationship: 'oneMany',
            isOneWay: false,
            foreignTableId: targetTableId,
            symmetricFieldId: storage === 'stale' ? nameFieldId : childFieldId,
            fkHostTableName: host,
            selfKeyName: fkName,
            foreignKeyName: '__id',
          })})
      `.execute(db);

      const captured: Array<Record<string, unknown>> = [];
      const repository = createRepository(db as unknown as Kysely<DynamicDB>, table, (input) =>
        captured.push(input)
      );
      const specBuilder = TableRecord.specs('or');
      specBuilder.recordId(RecordId.create(recordId)._unsafeUnwrap());
      specBuilder.recordId(RecordId.create(secondRecordId)._unsafeUnwrap());
      const deleteSpec = specBuilder.build()._unsafeUnwrap();
      const result = await repository.deleteMany(
        { actorId: ActorId.create('tester')._unsafeUnwrap() },
        table,
        deleteSpec
      );
      expect(result.isOk()).toBe(true);
      expect(captured).toHaveLength(1);
      expect(captured[0]?.capturedDeleteLinkFieldIds).toEqual(
        storage === 'missing' || storage === 'stale' ? [] : [parentFieldId]
      );
      const groups = captured[0]?.extraSeedRecords as Array<{
        tableId: TableId;
        recordIds: RecordId[];
      }>;
      const parentGroup = groups.find((group) => group.tableId.toString() === sourceTableId);
      expect((parentGroup?.recordIds.map((id) => id.toString()) ?? []).sort()).toEqual(
        storage === 'linked' || storage === 'stale' ? [parentId, secondParentId].sort() : []
      );
    }
  );
});
