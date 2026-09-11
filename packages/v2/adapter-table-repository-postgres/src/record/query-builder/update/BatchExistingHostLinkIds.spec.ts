import { PGlite } from '@electric-sql/pglite';
import {
  AndSpec,
  BaseId,
  CellValue,
  ClearFieldValueSpec,
  DbFieldName,
  FieldId,
  FieldName,
  LinkFieldConfig,
  RecordId,
  SetLinkValueSpec,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import type { LinkField } from '@teable/v2-core';
import { Kysely, sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { PGliteDialect } from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import type { DynamicDB } from '../ITableRecordQueryBuilder';
import { BatchRecordUpdateBuilder } from './BatchRecordUpdateBuilder';
import { collectLinkChanges, loadBatchExistingHostLinkIds } from './RecordUpdateBuilder';

const id = (prefix: string, seed: string) => prefix + seed.padEnd(16, '0');
const record = (seed: string) => RecordId.create('rec' + seed.padStart(16, '0'))._unsafeUnwrap();
const fixture = (relationship: 'manyOne' | 'oneOne' = 'manyOne') => {
  const builder = Table.builder()
    .withId(TableId.create(id('tbl', 'host'))._unsafeUnwrap())
    .withBaseId(BaseId.create(id('bse', 'base'))._unsafeUnwrap())
    .withName(TableName.create('Host')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  const fieldIds = ['a', 'b'].map((seed) => FieldId.create(id('fld', seed))._unsafeUnwrap());
  for (const fieldId of fieldIds)
    builder
      .field()
      .link()
      .withId(fieldId)
      .withName(FieldName.create(fieldId.toString())._unsafeUnwrap())
      .withConfig(
        LinkFieldConfig.create({
          relationship,
          isOneWay: true,
          foreignTableId: id('tbl', 'foreign'),
          lookupFieldId: id('fld', 'lookup'),
        })._unsafeUnwrap()
      )
      .done();
  const table = builder.view().defaultGrid().done().build()._unsafeUnwrap();
  const fields = fieldIds.map((fieldId, index) => {
    const field = table
      .getField((candidate) => candidate.id().equals(fieldId))
      ._unsafeUnwrap() as LinkField;
    field.setDbFieldName(DbFieldName.rehydrate('link_' + index)._unsafeUnwrap())._unsafeUnwrap();
    return field;
  });
  return { table, fields };
};

describe('batch existing host link IDs', () => {
  it.each(['manyOne', 'oneOne'] as const)(
    'batches %s reads while preserving old/new impacts, nulls and missing rows',
    async (relationship) => {
      const { table, fields } = fixture(relationship);
      const queries: string[] = [];
      const db = new Kysely<DynamicDB>({
        dialect: new PGliteDialect(new PGlite()),
        log: (event) => {
          if (event.level === 'query') queries.push(event.query.sql);
        },
      });
      try {
        const columns = fields.map((field) => field.foreignKeyNameString()._unsafeUnwrap());
        await sql`create table host (__id text primary key, ${sql.ref(columns[0])} text, ${sql.ref(columns[1])} text)`.execute(
          db
        );
        await db
          .insertInto('host')
          .values(
            Array.from({ length: 99 }, (_, i) => ({
              __id: record(String(i)).toString(),
              [columns[0]]: record('oldA').toString(),
              [columns[1]]: i === 0 ? null : record('oldB').toString(),
            }))
          )
          .execute();
        const updates = Array.from({ length: 100 }, (_, i) => ({
          recordId: record(String(i)),
          mutateSpec: new AndSpec(
            new SetLinkValueSpec(
              fields[0].id(),
              CellValue.fromValidated({ id: record('newA').toString() })
            ),
            new SetLinkValueSpec(
              fields[1].id(),
              CellValue.fromValidated({ id: record('newB').toString() })
            )
          ),
        }));
        const before = queries.length;
        const batch = (
          await loadBatchExistingHostLinkIds({ db, table, tableName: 'host', updates })
        )._unsafeUnwrap();
        expect(queries.length - before).toBe(1);
        expect(batch.get(record('0').toString())?.get(fields[1].id().toString())).toEqual([]);
        expect(batch.get(record('99').toString())?.get(fields[0].id().toString())).toEqual([]);
        for (const update of updates) {
          const params = {
            db,
            table,
            tableName: 'host',
            recordId: update.recordId.toString(),
            mutateSpec: update.mutateSpec,
          };
          const original = (await collectLinkChanges(params))._unsafeUnwrap();
          const count = queries.length;
          const prefetched = (
            await collectLinkChanges({ ...params, existingLinkIds: batch.get(params.recordId) })
          )._unsafeUnwrap();
          expect(prefetched).toEqual(original);
          expect(queries.length).toBe(count);
        }
        expect(queries.length - before).toBe(201);
        const builder = new BatchRecordUpdateBuilder(db);
        const start = queries.length;
        const result = (
          await builder.buildBatchUpdateData({
            table,
            tableName: 'host',
            updates,
            context: { actorId: id('usr', 'actor'), now: '2026-01-01T00:00:00.000Z' },
          })
        )._unsafeUnwrap();
        expect(queries.length - start).toBe(1);
        expect(result.recordIds).toEqual(updates.map((update) => update.recordId.toString()));
        expect(
          result.impact.extraSeedRecords.flatMap((group) => group.recordIds.map(String))
        ).toEqual(
          expect.arrayContaining([
            record('oldA').toString(),
            record('oldB').toString(),
            record('newA').toString(),
            record('newB').toString(),
          ])
        );
        const emptyStart = queries.length;
        expect(
          (
            await builder.buildBatchUpdateData({
              table,
              tableName: 'host',
              updates,
              context: {
                actorId: id('usr', 'actor'),
                now: '2026-01-01T00:00:00.000Z',
                assumeEmptyLinkState: true,
              },
            })
          ).isOk()
        ).toBe(true);
        expect(queries.length).toBe(emptyStart);
      } finally {
        await db.destroy();
      }
    }
  );
  it('bounds sparse clear requests to 500 rows and skips non-link fields', async () => {
    const { table, fields } = fixture();
    const queries: string[] = [];
    const db = new Kysely<DynamicDB>({
      dialect: new PGliteDialect(new PGlite()),
      log: (event) => {
        if (event.level === 'query') queries.push(event.query.sql);
      },
    });
    try {
      await sql`create table host (__id text primary key, ${sql.ref(fields[0].foreignKeyNameString()._unsafeUnwrap())} text, ${sql.ref(fields[1].foreignKeyNameString()._unsafeUnwrap())} text)`.execute(
        db
      );
      const updates = Array.from({ length: 501 }, (_, i) => ({
        recordId: record(String(i)),
        mutateSpec: new ClearFieldValueSpec(fields[i % 2]),
      }));
      const before = queries.length;
      const existing = (
        await loadBatchExistingHostLinkIds({ db, table, tableName: 'host', updates })
      )._unsafeUnwrap();
      expect(queries.length - before).toBe(2);
      expect(existing.size).toBe(501);
      for (let i = 0; i < updates.length; i++) {
        expect([...existing.get(record(String(i)).toString())!]).toEqual([
          [fields[i % 2].id().toString(), []],
        ]);
      }
      const scalar = table.getFields().find((field) => field.type().toString() !== 'link')!;
      const count = queries.length;
      expect(
        (
          await loadBatchExistingHostLinkIds({
            db,
            table,
            tableName: 'host',
            updates: [{ recordId: record('0'), mutateSpec: new ClearFieldValueSpec(scalar) }],
          })
        )._unsafeUnwrap().size
      ).toBe(0);
      expect(queries.length).toBe(count);
    } finally {
      await db.destroy();
    }
  });
});
