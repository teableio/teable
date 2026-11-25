import { PGlite } from '@electric-sql/pglite';
import {
  BaseId,
  CellValue,
  DbFieldName,
  FieldId,
  FieldName,
  RecordId,
  SetSingleLineTextValueSpec,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import type { IExecutionContext } from '@teable/v2-core';
import { CompiledQuery, Kysely, sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import { PGliteDialect } from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import type { DynamicDB } from '../ITableRecordQueryBuilder';
import { BatchRecordUpdateBuilder } from './BatchRecordUpdateBuilder';
import { buildBatchUpdateSql } from './BatchUpdateSqlBuilder';

const id = (prefix: string, seed: string) => prefix + seed.padEnd(16, '0');
const executor = id('usr', 'executor');
const recordId = RecordId.create(id('rec', 'record'))._unsafeUnwrap();
const sourceId = FieldId.create(id('fld', 'source'))._unsafeUnwrap();
const otherId = FieldId.create(id('fld', 'other'))._unsafeUnwrap();

const createTable = () => {
  const builder = Table.builder()
    .withId(TableId.create(id('tbl', 'batch'))._unsafeUnwrap())
    .withBaseId(BaseId.create(id('bse', 'base'))._unsafeUnwrap())
    .withName(TableName.create('Batch actor values')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(sourceId)
    .withName(FieldName.create('Source')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .singleLineText()
    .withId(otherId)
    .withName(FieldName.create('Other')._unsafeUnwrap())
    .done();
  builder
    .field()
    .lastModifiedBy()
    .withName(FieldName.create('Tracked modifier')._unsafeUnwrap())
    .withTrackedFieldIds([sourceId])
    .done();
  builder
    .field()
    .lastModifiedBy()
    .withName(FieldName.create('Any modifier')._unsafeUnwrap())
    .done();
  const table = builder.view().defaultGrid().done().build()._unsafeUnwrap();
  const columns = ['source', 'other', 'tracked_modifier', 'any_modifier'];
  table.getFields().forEach((field, index) => {
    field.setDbFieldName(DbFieldName.rehydrate(columns[index])._unsafeUnwrap())._unsafeUnwrap();
  });
  return table;
};

const cases: Array<{
  label: string;
  initiator: NonNullable<IExecutionContext['initiator']>;
  expectedId: string;
}> = [
  {
    label: 'App principal',
    initiator: { type: 'appUser', id: 'apuPrincipalA' },
    expectedId: 'apuPrincipalA',
  },
  {
    label: 'different platform principal',
    initiator: { type: 'user', id: id('usr', 'principalA') },
    expectedId: id('usr', 'principalA'),
  },
  { label: 'executor principal', initiator: { type: 'user', id: executor }, expectedId: executor },
  {
    label: 'automation',
    initiator: { type: 'automation', id: 'automationA' },
    expectedId: executor,
  },
  { label: 'system', initiator: { type: 'system', id: 'systemA' }, expectedId: executor },
];

describe('BatchRecordUpdateBuilder tracked modifier persistence', () => {
  it.each(cases)(
    'preserves the finalized $label cell across an unrelated edit',
    async ({ initiator, expectedId }) => {
      const db = new Kysely<DynamicDB>({ dialect: new PGliteDialect(new PGlite()) });
      try {
        await sql`create table batch_records (
        __id text primary key, __version integer not null default 1,
        __last_modified_by text, __last_modified_time timestamptz,
        source text, other text, tracked_modifier jsonb, any_modifier jsonb
      )`.execute(db);
        await db.insertInto('batch_records').values({ __id: recordId.toString() }).execute();
        const table = createTable();
        const builder = new BatchRecordUpdateBuilder(db);
        const persist = async (
          fieldId: FieldId,
          actor: NonNullable<IExecutionContext['initiator']>
        ) => {
          const plan = (
            await builder.buildBatchUpdateData({
              table,
              tableName: 'batch_records',
              updates: [
                {
                  recordId,
                  mutateSpec: new SetSingleLineTextValueSpec(
                    fieldId,
                    CellValue.fromValidated('changed')
                  ),
                },
              ],
              context: {
                actorId: executor,
                initiator: actor,
                actorName: 'Executor',
                actorEmail: 'executor@example.invalid',
                now: '2026-11-15T00:00:00.000Z',
              },
            })
          )._unsafeUnwrap();
          const compiled = buildBatchUpdateSql({
            tableName: 'batch_records',
            table,
            db,
            columnUpdateData: plan.columnUpdateData,
            systemColumns: plan.systemColumns,
          })._unsafeUnwrap();
          await db.executeQuery(CompiledQuery.raw(compiled.sql, compiled.parameters));
          return plan;
        };
        const expected = {
          id: expectedId,
          title: expectedId === executor ? 'Executor' : expectedId,
          email: expectedId === executor ? 'executor@example.invalid' : null,
        };
        await persist(sourceId, initiator);
        const first = await db.selectFrom('batch_records').selectAll().executeTakeFirstOrThrow();
        expect(first.tracked_modifier).toEqual(expected);
        expect(first.any_modifier).toEqual(expected);
        expect(first.__last_modified_by).toBe(executor);

        const secondPlan = await persist(otherId, { type: 'appUser', id: 'apuPrincipalB' });
        expect(secondPlan.columnUpdateData.has('tracked_modifier')).toBe(false);
        const second = await db.selectFrom('batch_records').selectAll().executeTakeFirstOrThrow();
        expect(second.tracked_modifier).toEqual(expected);
        expect(second.any_modifier).toEqual({
          id: 'apuPrincipalB',
          title: 'apuPrincipalB',
          email: null,
        });
        expect(second.__last_modified_by).toBe(executor);
        expect(second.__version).toBe(3);
      } finally {
        await db.destroy();
      }
    }
  );
});
