/* eslint-disable @typescript-eslint/naming-convention */
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import type {
  BaseDataBulkCopyPlan,
  BaseDataBulkCopyProgress,
  IBaseDataBulkCopier,
} from '@teable/v2-core';
import { ActorId, v2CoreTokens } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  getV2NodeTestContainer,
  setV2NodeTestContainer,
} from '../integration/testkit/v2NodeTestContainer';

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const qualified = (dbTableName: string): string =>
  dbTableName.split('.').map(quoteIdentifier).join('.');

describe('PostgresBaseDataBulkCopier (db)', () => {
  beforeEach(async () => {
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  const createDataTables = async (db: Kysely<V1TeableDatabase>, schema: string) => {
    await sql.raw(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`).execute(db);
    // Ordinary table: full copy including the remapped link fk column.
    for (const table of [`${schema}.bulk_src_a`, `${schema}.bulk_tgt_a`]) {
      await sql
        .raw(
          `CREATE TABLE ${qualified(table)} (
            "__id" text PRIMARY KEY,
            "__auto_number" serial,
            "__version" integer,
            "title" text,
            "__fk_fldoldlink000001" text,
            "computed_col" text,
            "__created_time" timestamptz DEFAULT now()
          )`
        )
        .execute(db);
    }
    // Table with a cross-base link value column (json) that downgrades to text.
    for (const [table, linkColumnType] of [
      [`${schema}.bulk_src_b`, 'jsonb'],
      [`${schema}.bulk_tgt_b`, 'text'],
    ] as const) {
      await sql
        .raw(
          `CREATE TABLE ${qualified(table)} (
            "__id" text PRIMARY KEY,
            "__auto_number" serial,
            "__version" integer,
            "name" text,
            "link_ext" ${linkColumnType},
            "__created_time" timestamptz DEFAULT now()
          )`
        )
        .execute(db);
    }
    await sql
      .raw(
        `INSERT INTO ${qualified(`${schema}.bulk_src_a`)} ("__id", "__version", "title", "__fk_fldoldlink000001", "computed_col")
         VALUES ('reca1', 5, 'alpha', 'recx1', 'computed-1'),
                ('reca2', 5, 'beta', 'recx2', 'computed-2'),
                ('reca3', 5, 'gamma', NULL, 'computed-3')`
      )
      .execute(db);
    await sql
      .raw(
        `INSERT INTO ${qualified(`${schema}.bulk_src_b`)} ("__id", "__version", "name", "link_ext")
         VALUES ('recb1', 2, 'delta', '{"id":"recExt","title":"Ext Title"}'::jsonb)`
      )
      .execute(db);
    // The production T6990 shape: a same-named foreign key on several tables in
    // one schema (v2 names link FKs `fk_{column}`, legacy bases carry a bogus
    // self-FK `fk___id` on the record id column).
    for (const table of [
      `${schema}.bulk_src_a`,
      `${schema}.bulk_tgt_a`,
      `${schema}.bulk_src_b`,
      `${schema}.bulk_tgt_b`,
    ]) {
      await sql
        .raw(
          `ALTER TABLE ${qualified(table)} ADD CONSTRAINT "fk___id" FOREIGN KEY ("__id") REFERENCES ${qualified(table)} ("__id") ON DELETE SET NULL`
        )
        .execute(db);
    }
    await sql
      .raw(
        `CREATE TABLE ${qualified(`${schema}.junction_bulk_old`)} ("__fk_old_self" text, "__fk_old_foreign" text)`
      )
      .execute(db);
    await sql
      .raw(
        `CREATE TABLE ${qualified(`${schema}.junction_bulk_new`)} ("__fk_new_self" text, "__fk_new_foreign" text)`
      )
      .execute(db);
    await sql
      .raw(
        `INSERT INTO ${qualified(`${schema}.junction_bulk_old`)} VALUES ('reca1', 'recb1'), ('reca2', 'recb1')`
      )
      .execute(db);
  };

  const buildPlan = (schema: string): BaseDataBulkCopyPlan => ({
    tables: [
      {
        sourceTableId: 'tblSrcA',
        targetTableId: 'tblTgtA',
        targetTableName: 'Target A',
        sourceDbTableName: `${schema}.bulk_src_a`,
        targetDbTableName: `${schema}.bulk_tgt_a`,
        excludedTargetColumns: ['computed_col'],
        linkValueColumns: [],
      },
      {
        sourceTableId: 'tblSrcB',
        targetTableId: 'tblTgtB',
        targetTableName: 'Target B',
        sourceDbTableName: `${schema}.bulk_src_b`,
        targetDbTableName: `${schema}.bulk_tgt_b`,
        excludedTargetColumns: [],
        linkValueColumns: [
          { dbFieldName: 'link_ext', selfKeyName: '__id', isMultipleCellValue: false },
        ],
      },
    ],
    junctions: [
      {
        sourceJunctionDbTableName: `${schema}.junction_bulk_old`,
        targetJunctionDbTableName: `${schema}.junction_bulk_new`,
        sourceSelfKeyName: '__fk_old_self',
        sourceForeignKeyName: '__fk_old_foreign',
        targetSelfKeyName: '__fk_new_self',
        targetForeignKeyName: '__fk_new_foreign',
      },
    ],
    viewIdMap: {},
    fieldIdMap: { fldoldlink000001: 'fldnewlink000001' },
    batchSize: 2,
  });

  it('copies rows, remapped columns and junctions while preserving same-named foreign keys', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const copier = container.resolve<IBaseDataBulkCopier>(v2CoreTokens.baseDataBulkCopier);
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);
    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
    const schema = baseId.toString();
    await createDataTables(db, schema);
    const plan = buildPlan(schema);

    const supported = await copier.isSupported(context, plan);
    expect(supported._unsafeUnwrap()).toBe(true);

    const progressEvents: BaseDataBulkCopyProgress[] = [];
    const result = await copier.copyBaseData(context, plan, (progress) =>
      progressEvents.push(progress)
    );
    expect(result._unsafeUnwrap().recordsLength).toBe(4);

    const targetARows = await sql<{
      id: string;
      version: number;
      title: string;
      fk: string | null;
      computed: string | null;
    }>`
      SELECT "__id" AS id, "__version" AS version, "title",
             "__fk_fldnewlink000001" AS fk, "computed_col" AS computed
      FROM ${sql.raw(qualified(`${schema}.bulk_tgt_a`))}
      ORDER BY "__auto_number"
    `.execute(db);
    expect(targetARows.rows).toEqual([
      { id: 'reca1', version: 1, title: 'alpha', fk: 'recx1', computed: null },
      { id: 'reca2', version: 1, title: 'beta', fk: 'recx2', computed: null },
      { id: 'reca3', version: 1, title: 'gamma', fk: null, computed: null },
    ]);

    const targetBRows = await sql<{ id: string; name: string; linkExt: string | null }>`
      SELECT "__id" AS id, "name", "link_ext" AS "linkExt"
      FROM ${sql.raw(qualified(`${schema}.bulk_tgt_b`))}
    `.execute(db);
    expect(targetBRows.rows).toEqual([{ id: 'recb1', name: 'delta', linkExt: 'Ext Title' }]);

    const junctionRows = await sql<{ self: string; foreign: string }>`
      SELECT "__fk_new_self" AS self, "__fk_new_foreign" AS foreign
      FROM ${sql.raw(qualified(`${schema}.junction_bulk_new`))}
      ORDER BY "__fk_new_self"
    `.execute(db);
    expect(junctionRows.rows).toEqual([
      { self: 'reca1', foreign: 'recb1' },
      { self: 'reca2', foreign: 'recb1' },
    ]);

    // Every same-named FK survived the drop→rebuild cycle with its delete rule.
    const fkRows = await sql<{ tableName: string; deleteRule: string }>`
      SELECT rel.relname AS "tableName",
             CASE con.confdeltype
               WHEN 'a' THEN 'NO ACTION'
               WHEN 'r' THEN 'RESTRICT'
               WHEN 'c' THEN 'CASCADE'
               WHEN 'n' THEN 'SET NULL'
               WHEN 'd' THEN 'SET DEFAULT'
             END AS "deleteRule"
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE con.contype = 'f' AND nsp.nspname = ${schema} AND con.conname = 'fk___id'
      ORDER BY rel.relname
    `.execute(db);
    expect(fkRows.rows).toEqual([
      { tableName: 'bulk_src_a', deleteRule: 'SET NULL' },
      { tableName: 'bulk_src_b', deleteRule: 'SET NULL' },
      { tableName: 'bulk_tgt_a', deleteRule: 'SET NULL' },
      { tableName: 'bulk_tgt_b', deleteRule: 'SET NULL' },
    ]);

    // Source tables are untouched.
    const sourceCount = await sql<{ count: string }>`
      SELECT COUNT(*) AS count FROM ${sql.raw(qualified(`${schema}.bulk_src_a`))}
    `.execute(db);
    expect(Number(sourceCount.rows[0]?.count)).toBe(3);

    expect(progressEvents[0]).toEqual({
      phase: 'table_data_start',
      processedRows: 0,
      totalRows: 4,
    });
    expect(
      progressEvents.filter((event) => event.phase === 'table_data_progress').length
    ).toBeGreaterThanOrEqual(3);
    expect(progressEvents[progressEvents.length - 1]).toEqual({
      phase: 'table_data_done',
      processedRows: 4,
      totalRows: 4,
    });
  });

  it('reports unsupported when a source schema is not reachable', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const copier = container.resolve<IBaseDataBulkCopier>(v2CoreTokens.baseDataBulkCopier);
    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
    const schema = baseId.toString();
    const plan = buildPlan(schema);
    const unreachablePlan: BaseDataBulkCopyPlan = {
      ...plan,
      tables: [
        {
          ...plan.tables[0]!,
          sourceDbTableName: 'bseMissingSchema0000.bulk_src_a',
        },
      ],
      junctions: [],
    };

    const supported = await copier.isSupported(context, unreachablePlan);
    expect(supported._unsafeUnwrap()).toBe(false);
  });
});
