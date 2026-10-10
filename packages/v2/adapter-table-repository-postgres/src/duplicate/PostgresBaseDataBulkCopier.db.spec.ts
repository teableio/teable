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
    const fkRows = await sql<{ tableName: string; deleteRule: string; validated: boolean }>`
      SELECT rel.relname AS "tableName",
             CASE con.confdeltype
               WHEN 'a' THEN 'NO ACTION'
               WHEN 'r' THEN 'RESTRICT'
               WHEN 'c' THEN 'CASCADE'
               WHEN 'n' THEN 'SET NULL'
               WHEN 'd' THEN 'SET DEFAULT'
             END AS "deleteRule",
             con.convalidated AS validated
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE con.contype = 'f' AND nsp.nspname = ${schema} AND con.conname = 'fk___id'
      ORDER BY rel.relname
    `.execute(db);
    // Clean copied rows keep a validated FK on the target: only dangling source
    // values may cost the constraint its validated state.
    expect(fkRows.rows).toEqual([
      { tableName: 'bulk_src_a', deleteRule: 'SET NULL', validated: true },
      { tableName: 'bulk_src_b', deleteRule: 'SET NULL', validated: true },
      { tableName: 'bulk_tgt_a', deleteRule: 'SET NULL', validated: true },
      { tableName: 'bulk_tgt_b', deleteRule: 'SET NULL', validated: true },
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

  it('rejects an empty source schema left behind after a database move', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);
    const copier = container.resolve<IBaseDataBulkCopier>(v2CoreTokens.baseDataBulkCopier);
    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
    const schema = baseId.toString();
    await sql.raw(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`).execute(db);

    const supported = await copier.isSupported(context, buildPlan(schema));

    expect(supported._unsafeUnwrap()).toBe(false);
  });

  it('rejects a plan whose source tables exist but source junction is absent', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);
    const copier = container.resolve<IBaseDataBulkCopier>(v2CoreTokens.baseDataBulkCopier);
    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
    const schema = baseId.toString();
    await createDataTables(db, schema);
    await sql.raw(`DROP TABLE ${qualified(`${schema}.junction_bulk_old`)}`).execute(db);

    const supported = await copier.isSupported(context, buildPlan(schema));

    expect(supported._unsafeUnwrap()).toBe(false);
  });

  // T7655: legacy bases carry link FKs created NOT VALID (the import paths add
  // them that way to skip validating existing data), so such a table can hold
  // link values whose record no longer exists. The copier drops every FK of the
  // source and target tables and rebuilds them afterwards; rebuilding the source
  // FK as validated re-checks the source's own dangling rows, and rebuilding the
  // target FK as validated re-checks the dangling rows the copy just brought
  // over — both abort the copy with PG 23503. The source FK has to come back in
  // the state it had; the target FK has to fall back to NOT VALID instead.
  it('keeps a NOT VALID source link FK and falls back for the target FK', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const copier = container.resolve<IBaseDataBulkCopier>(v2CoreTokens.baseDataBulkCopier);
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);
    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
    const schema = baseId.toString();
    await sql.raw(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`).execute(db);

    const sourceLinkColumn = '__fk_fldsrclink00000001';
    const targetLinkColumn = '__fk_fldtgtlink00000001';
    const cleanSourceLinkColumn = '__fk_fldsrclink00000002';
    const cleanTargetLinkColumn = '__fk_fldtgtlink00000002';
    const orphanSourceLinkColumn = '__fk_fldsrclink00000003';
    const orphanTargetLinkColumn = '__fk_fldtgtlink00000003';
    const sourceConstraint = `fk_${sourceLinkColumn}`;
    const targetConstraint = `fk_${targetLinkColumn}`;
    const cleanSourceConstraint = `fk_${cleanSourceLinkColumn}`;
    const cleanTargetConstraint = `fk_${cleanTargetLinkColumn}`;
    const orphanTargetConstraint = `fk_${orphanTargetLinkColumn}`;

    for (const table of ['fk_src_parent', 'fk_tgt_parent']) {
      await sql
        .raw(
          `CREATE TABLE ${qualified(`${schema}.${table}`)} (
            "__id" text PRIMARY KEY,
            "__auto_number" serial,
            "name" text
          )`
        )
        .execute(db);
    }
    for (const [table, linkColumns] of [
      ['fk_src_child', [sourceLinkColumn, cleanSourceLinkColumn, orphanSourceLinkColumn]],
      ['fk_tgt_child', [targetLinkColumn, cleanTargetLinkColumn, orphanTargetLinkColumn]],
    ] as const) {
      await sql
        .raw(
          `CREATE TABLE ${qualified(`${schema}.${table}`)} (
            "__id" text PRIMARY KEY,
            "__auto_number" serial,
            "name" text,
            ${linkColumns.map((column) => `${quoteIdentifier(column)} text`).join(',\n            ')}
          )`
        )
        .execute(db);
    }
    await sql
      .raw(
        `INSERT INTO ${qualified(`${schema}.fk_src_parent`)} ("__id", "name") VALUES ('recparent00000001', 'Parent')`
      )
      .execute(db);
    await sql
      .raw(
        `INSERT INTO ${qualified(`${schema}.fk_src_child`)} ("__id", "name", ${quoteIdentifier(sourceLinkColumn)}, ${quoteIdentifier(cleanSourceLinkColumn)}, ${quoteIdentifier(orphanSourceLinkColumn)})
         VALUES ('recchild000000001', 'Linked', 'recparent00000001', 'recparent00000001', 'recparent00000001'),
                ('recchild000000002', 'Dangling', 'recmissing0000001', 'recparent00000001', 'recmissing0000002')`
      )
      .execute(db);
    // The reported production shape: a source FK created NOT VALID, here over a
    // row whose link value has no matching record; a second NOT VALID source FK
    // covers clean rows only, and a third link column has no source FK at all.
    for (const [constraint, column] of [
      [sourceConstraint, sourceLinkColumn],
      [cleanSourceConstraint, cleanSourceLinkColumn],
    ] as const) {
      await sql
        .raw(
          `ALTER TABLE ${qualified(`${schema}.fk_src_child`)} ADD CONSTRAINT ${quoteIdentifier(constraint)} FOREIGN KEY (${quoteIdentifier(column)}) REFERENCES ${qualified(`${schema}.fk_src_parent`)} ("__id") NOT VALID`
        )
        .execute(db);
    }
    // v2 creates target link FKs validated on the still empty target table.
    for (const [constraint, column] of [
      [targetConstraint, targetLinkColumn],
      [cleanTargetConstraint, cleanTargetLinkColumn],
      [orphanTargetConstraint, orphanTargetLinkColumn],
    ] as const) {
      await sql
        .raw(
          `ALTER TABLE ${qualified(`${schema}.fk_tgt_child`)} ADD CONSTRAINT ${quoteIdentifier(constraint)} FOREIGN KEY (${quoteIdentifier(column)}) REFERENCES ${qualified(`${schema}.fk_tgt_parent`)} ("__id")`
        )
        .execute(db);
    }

    const plan: BaseDataBulkCopyPlan = {
      tables: [
        {
          sourceTableId: 'tblSrcParent',
          targetTableId: 'tblTgtParent',
          targetTableName: 'Target parent',
          sourceDbTableName: `${schema}.fk_src_parent`,
          targetDbTableName: `${schema}.fk_tgt_parent`,
          excludedTargetColumns: [],
          linkValueColumns: [],
        },
        {
          sourceTableId: 'tblSrcChild',
          targetTableId: 'tblTgtChild',
          targetTableName: 'Target child',
          sourceDbTableName: `${schema}.fk_src_child`,
          targetDbTableName: `${schema}.fk_tgt_child`,
          excludedTargetColumns: [],
          linkValueColumns: [],
        },
      ],
      junctions: [],
      viewIdMap: {},
      fieldIdMap: {
        fldsrclink00000001: 'fldtgtlink00000001',
        fldsrclink00000002: 'fldtgtlink00000002',
        fldsrclink00000003: 'fldtgtlink00000003',
      },
      batchSize: 100,
    };

    const result = await copier.copyBaseData(context, plan);
    expect(result._unsafeUnwrap().recordsLength).toBe(3);

    const copiedRows = await sql<{
      id: string;
      link: string | null;
      cleanLink: string | null;
      orphanLink: string | null;
    }>`
      SELECT "__id" AS id, ${sql.ref(targetLinkColumn)} AS link,
             ${sql.ref(cleanTargetLinkColumn)} AS "cleanLink",
             ${sql.ref(orphanTargetLinkColumn)} AS "orphanLink"
      FROM ${sql.raw(qualified(`${schema}.fk_tgt_child`))}
      ORDER BY "__auto_number"
    `.execute(db);
    expect(copiedRows.rows).toEqual([
      {
        id: 'recchild000000001',
        link: 'recparent00000001',
        cleanLink: 'recparent00000001',
        orphanLink: 'recparent00000001',
      },
      {
        id: 'recchild000000002',
        link: 'recmissing0000001',
        cleanLink: 'recparent00000001',
        orphanLink: 'recmissing0000002',
      },
    ]);

    const fkState = async (table: string, constraintName: string) => {
      const rows = await sql<{ validated: boolean }>`
        SELECT con.convalidated AS validated
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE con.contype = 'f' AND nsp.nspname = ${schema}
          AND rel.relname = ${table} AND con.conname = ${constraintName}
      `.execute(db);
      return rows.rows;
    };

    // Source FKs come back exactly as they were, and the source column that had
    // no FK still has none.
    expect(await fkState('fk_src_child', sourceConstraint)).toEqual([{ validated: false }]);
    expect(await fkState('fk_src_child', cleanSourceConstraint)).toEqual([{ validated: false }]);
    expect(await fkState('fk_src_child', `fk_${orphanSourceLinkColumn}`)).toEqual([]);
    // Target FKs: the one over copied dangling values falls back to NOT VALID,
    // while clean copied values keep the constraint validated — including the
    // column whose source FK is missing, where only the data decides.
    expect(await fkState('fk_tgt_child', targetConstraint)).toEqual([{ validated: false }]);
    expect(await fkState('fk_tgt_child', cleanTargetConstraint)).toEqual([{ validated: true }]);
    expect(await fkState('fk_tgt_child', orphanTargetConstraint)).toEqual([{ validated: false }]);
  });
});
