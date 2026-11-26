/* eslint-disable @typescript-eslint/naming-convention */
import {
  createRecordOkResponseSchema,
  createRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
  updateRecordsOkResponseSchema,
} from '@teable/v2-contract-http';
import { getRandomString } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

type WritePath = 'createRecord' | 'createRecords' | 'updateRecord' | 'updateRecords';
type RecordValue = { id: string; fields: Record<string, unknown> };

type LinkAudit = {
  read(): Promise<ReadonlyArray<{ record_id: string; link_value: unknown }>>;
  dispose(): Promise<void>;
};

// Exercise the real PG text[] bindings used by SQL title fill, not a recording DB
// or PGlite. The bulk variants send the mixed and empty cells in the same request.
describe('v2 http multi-value link title fill on PostgreSQL (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  const postWrite = async (
    path: WritePath,
    payload: Record<string, unknown>
  ): Promise<ReadonlyArray<RecordValue>> => {
    const response = await fetch(`${ctx.baseUrl}/tables/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, typecast: true }),
    });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(path.startsWith('create') ? 201 : 200);

    if (path === 'createRecord') {
      const result = createRecordOkResponseSchema.parse(body);
      if (!result.ok) throw new Error('createRecord failed');
      return [result.data.record];
    }
    if (path === 'createRecords') {
      const result = createRecordsOkResponseSchema.parse(body);
      if (!result.ok) throw new Error('createRecords failed');
      return result.data.records;
    }
    if (path === 'updateRecord') {
      const result = updateRecordOkResponseSchema.parse(body);
      if (!result.ok) throw new Error('updateRecord failed');
      return [result.data.record];
    }
    const result = updateRecordsOkResponseSchema.parse(body);
    if (!result.ok) throw new Error('updateRecords failed');
    expect(result.data.updatedCount).toBe(2);
    return result.data.records;
  };

  const loadLinkStorage = async (tableId: string, fieldId: string) => {
    const table = await ctx.testContainer.db
      .selectFrom('table_meta')
      .select('db_table_name')
      .where('id', '=', tableId)
      .executeTakeFirstOrThrow();
    const field = await ctx.testContainer.db
      .selectFrom('field')
      .select('db_field_name')
      .where('id', '=', fieldId)
      .executeTakeFirstOrThrow();
    if (!field.db_field_name) throw new Error('Missing link storage column');
    return { tableName: table.db_table_name, columnName: field.db_field_name };
  };

  const installLinkWriteAudit = async (
    sourceDbTableName: string,
    linkDbFieldName: string
  ): Promise<LinkAudit> => {
    const suffix = getRandomString(8).toLowerCase();
    const auditTableName = `t8242_link_title_audit_${suffix}`;
    const functionName = `t8242_link_title_audit_fn_${suffix}`;
    const insertTriggerName = `t8242_link_title_audit_ins_${suffix}`;
    const updateTriggerName = `t8242_link_title_audit_upd_${suffix}`;

    await sql`
      CREATE UNLOGGED TABLE ${sql.table(`public.${auditTableName}`)} (
        seq bigint GENERATED ALWAYS AS IDENTITY,
        record_id text NOT NULL,
        link_value jsonb
      )
    `.execute(ctx.testContainer.db);
    await sql`
      CREATE FUNCTION ${sql.id('public', functionName)}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO ${sql.table(`public.${auditTableName}`)} (record_id, link_value)
        VALUES (NEW.__id, NEW.${sql.id(linkDbFieldName)});
        RETURN NULL;
      END;
      $$
    `.execute(ctx.testContainer.db);
    await sql`
      CREATE TRIGGER ${sql.id(insertTriggerName)}
      AFTER INSERT ON ${sql.table(sourceDbTableName)}
      FOR EACH ROW EXECUTE FUNCTION ${sql.id('public', functionName)}()
    `.execute(ctx.testContainer.db);
    await sql`
      CREATE TRIGGER ${sql.id(updateTriggerName)}
      AFTER UPDATE OF ${sql.id(linkDbFieldName)} ON ${sql.table(sourceDbTableName)}
      FOR EACH ROW EXECUTE FUNCTION ${sql.id('public', functionName)}()
    `.execute(ctx.testContainer.db);

    return {
      read: async () =>
        (
          await sql<{ record_id: string; link_value: unknown }>`
            SELECT record_id, link_value
            FROM ${sql.table(`public.${auditTableName}`)}
            ORDER BY seq
          `.execute(ctx.testContainer.db)
        ).rows,
      dispose: async () => {
        await sql`
          DROP TRIGGER IF EXISTS ${sql.id(insertTriggerName)} ON ${sql.table(sourceDbTableName)}
        `.execute(ctx.testContainer.db);
        await sql`
          DROP TRIGGER IF EXISTS ${sql.id(updateTriggerName)} ON ${sql.table(sourceDbTableName)}
        `.execute(ctx.testContainer.db);
        await sql`DROP FUNCTION IF EXISTS ${sql.id('public', functionName)}()`.execute(
          ctx.testContainer.db
        );
        await sql`DROP TABLE IF EXISTS ${sql.table(`public.${auditTableName}`)}`.execute(
          ctx.testContainer.db
        );
      },
    };
  };

  it('preserves large amounts and literal currency symbols on batch link writes', async () => {
    const amountId = `fld${getRandomString(16)}`;
    const linkId = `fld${getRandomString(16)}`;
    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Currency targets',
      fields: [
        {
          id: amountId,
          name: 'Amount',
          type: 'number',
          isPrimary: true,
          options: { formatting: { type: 'currency', symbol: '$1', precision: 2 } },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const target = await ctx.createRecord(foreign.id, { [amountId]: 1000000000.5 });
    const source = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Currency sources',
      fields: [
        { name: 'Name', type: 'singleLineText', isPrimary: true },
        {
          id: linkId,
          name: 'Amount',
          type: 'link',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreign.id,
            lookupFieldId: amountId,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const sources = await ctx.createRecords(source.id, [{ fields: {} }, { fields: {} }]);
    await ctx.drainOutbox();
    const { tableName, columnName } = await loadLinkStorage(source.id, linkId);
    const audit = await installLinkWriteAudit(tableName, columnName);
    try {
      const updated = await postWrite('updateRecords', {
        tableId: source.id,
        records: sources.map(({ id }) => ({ id, fields: { [linkId]: [{ id: target.id }] } })),
      });
      const expected = [{ id: target.id, title: '$11000000000.50' }];
      const writes = await audit.read();
      for (const { id } of sources) {
        expect(writes.find(({ record_id }) => record_id === id)?.link_value).toEqual(expected);
      }
      expect(updated.map(({ fields }) => fields[linkId])).toEqual([expected, expected]);
      await ctx.drainOutbox();
      const stored = await ctx.listRecordsWithoutDrain(source.id);
      expect(stored.map(({ fields }) => fields[linkId])).toEqual([expected, expected]);
    } finally {
      await audit.dispose();
    }
  });

  it.each<WritePath>(['createRecord', 'createRecords', 'updateRecord', 'updateRecords'])(
    '%s fills missing titles at write time and converges to authoritative titles',
    async (path) => {
      const foreignTitleFieldId = `fld${getRandomString(16)}`;
      const sourceTitleFieldId = `fld${getRandomString(16)}`;
      const linkFieldId = `fld${getRandomString(16)}`;
      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Title fill targets ${path} ${getRandomString(8)}`,
        fields: [
          { id: foreignTitleFieldId, type: 'singleLineText', name: 'Name', isPrimary: true },
        ],
        views: [{ type: 'grid' }],
      });
      const titleB = 'B "quoted", {braces}, \\backslash 中文';
      const titleC = 'C [array], "quote" \\path 雪';
      const [targetA, targetB, targetC, blankTarget] = await ctx.createRecords(foreign.id, [
        { fields: { [foreignTitleFieldId]: 'Authoritative A' } },
        { fields: { [foreignTitleFieldId]: titleB } },
        { fields: { [foreignTitleFieldId]: titleC } },
        { fields: { [foreignTitleFieldId]: null } },
      ]);
      if (!targetA || !targetB || !targetC || !blankTarget) {
        throw new Error('Missing link title targets');
      }

      const source = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Title fill sources ${path} ${getRandomString(8)}`,
        fields: [
          { id: sourceTitleFieldId, type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            id: linkFieldId,
            type: 'link',
            name: 'Targets',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignTitleFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const { tableName, columnName } = await loadLinkStorage(source.id, linkFieldId);

      const explicitTitle = 'Explicit "override", {json} \\ 雪\nline\tend';
      // normalizeLinkItems keeps the FIRST occurrence, then SQL COALESCE fills
      // only its missing title. A later duplicate must neither move the id nor
      // supply/replace its title. A null foreign title remains absent, not null.
      const mixedLinks = [
        { id: targetC.id },
        { id: targetA.id, title: explicitTitle },
        { id: targetC.id, title: 'Ignored later title for C' },
        { id: targetB.id },
        { id: targetA.id, title: 'Ignored later title for A' },
        { id: blankTarget.id },
      ];
      const expectedWriteTimeLinks = [
        { id: targetC.id, title: titleC },
        { id: targetA.id, title: explicitTitle },
        { id: targetB.id, title: titleB },
        { id: blankTarget.id },
      ];
      const expectedFinalLinks = [
        { id: targetC.id, title: titleC },
        { id: targetA.id, title: 'Authoritative A' },
        { id: targetB.id, title: titleB },
        { id: blankTarget.id },
      ];
      const writes = [
        { fields: { [sourceTitleFieldId]: 'Mixed', [linkFieldId]: mixedLinks } },
        { fields: { [sourceTitleFieldId]: 'Empty', [linkFieldId]: [] } },
      ];
      let existing: ReadonlyArray<RecordValue> = [];
      if (path === 'updateRecord' || path === 'updateRecords') {
        existing = await ctx.createRecords(
          source.id,
          writes.map(({ fields }) => ({
            fields: {
              [sourceTitleFieldId]: fields[sourceTitleFieldId],
              [linkFieldId]: [{ id: targetB.id, title: titleB }],
            },
          }))
        );
      }
      // Install the audit only after fixture writes have converged. An AFTER
      // trigger captures the value produced by the user-write SQL before a
      // synchronous or outbox computed refresh can replace cached link titles.
      await ctx.drainOutbox();
      const audit = await installLinkWriteAudit(tableName, columnName);
      try {
        let written: ReadonlyArray<RecordValue>;
        if (path === 'updateRecord' || path === 'updateRecords') {
          const updates = existing.map((record, index) => ({
            id: record.id,
            fields: writes[index]!.fields,
          }));
          if (path === 'updateRecords') {
            written = await postWrite(path, { tableId: source.id, records: updates });
          } else {
            written = [];
            for (const update of updates) {
              written = [
                ...written,
                ...(await postWrite(path, {
                  tableId: source.id,
                  recordId: update.id,
                  fields: update.fields,
                })),
              ];
            }
          }
        } else if (path === 'createRecords') {
          written = await postWrite(path, { tableId: source.id, records: writes });
        } else {
          written = [];
          for (const write of writes) {
            written = [
              ...written,
              ...(await postWrite(path, { tableId: source.id, fields: write.fields })),
            ];
          }
        }
        expect(written).toHaveLength(2);

        const mixedRecord = written.find((record) => record.fields[sourceTitleFieldId] === 'Mixed');
        const emptyRecord = written.find((record) => record.fields[sourceTitleFieldId] === 'Empty');
        expect(mixedRecord).toBeDefined();
        expect(emptyRecord).toBeDefined();
        const auditRows = await audit.read();
        const firstMixedWrite = auditRows.find(({ record_id }) => record_id === mixedRecord?.id);
        expect(firstMixedWrite?.link_value).toEqual(expectedWriteTimeLinks);
        const firstEmptyWrite = auditRows.find(({ record_id }) => record_id === emptyRecord?.id);
        expect(
          firstEmptyWrite?.link_value === null ||
            (Array.isArray(firstEmptyWrite?.link_value) && firstEmptyWrite.link_value.length === 0)
        ).toBe(true);

        // Link JSON is a cache: computed convergence rebuilds every title from
        // the configured foreign lookup field. Thus an explicit stale title is
        // honored by write-time COALESCE, but is not the final product value.
        await ctx.drainOutbox();
        const stored = await sql<{ id: string; link_value: unknown }>`
          SELECT __id AS id, ${sql.id(columnName)} AS link_value
          FROM ${sql.table(tableName)}
          WHERE __id IN (${sql.join(written.map((record) => record.id))})
        `.execute(ctx.testContainer.db);
        const listed = await ctx.listRecordsWithoutDrain(source.id);
        for (const write of writes) {
          const record = listed.find(
            (row) => row.fields[sourceTitleFieldId] === write.fields[sourceTitleFieldId]
          );
          expect(record).toBeDefined();
          const storedRow = stored.rows.find((row) => row.id === record?.id);
          expect(storedRow).toBeDefined();
          if (write.fields[sourceTitleFieldId] === 'Mixed') {
            expect(storedRow?.link_value).toEqual(expectedFinalLinks);
            expect(record?.fields[linkFieldId]).toEqual(expectedFinalLinks);
          } else {
            // Existing createRecords empty-link contract permits null or [], but
            // never a phantom link or an id-only remnant of the previous value.
            for (const value of [storedRow?.link_value, record?.fields[linkFieldId]]) {
              expect(value === null || (Array.isArray(value) && value.length === 0)).toBe(true);
            }
          }
        }
      } finally {
        await audit.dispose();
      }
    }
  );

  it('writes formatted currency titles on the first INSERT for typecast ID strings and arrays', async () => {
    const amountId = `fld${getRandomString(16)}`;
    const linkId = `fld${getRandomString(16)}`;
    const targets = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Typecast currency targets',
      fields: [
        {
          id: amountId,
          type: 'number',
          name: 'Amount',
          isPrimary: true,
          options: { formatting: { type: 'currency', symbol: '$', precision: 2 } },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const [first, second] = await ctx.createRecords(targets.id, [
      { fields: { [amountId]: 1000.5 } },
      { fields: { [amountId]: 2 } },
    ]);
    if (!first || !second) throw new Error('Missing currency targets');
    const source = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Typecast currency sources',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        {
          id: linkId,
          type: 'link',
          name: 'Amounts',
          options: {
            relationship: 'manyMany',
            foreignTableId: targets.id,
            lookupFieldId: amountId,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const { tableName, columnName } = await loadLinkStorage(source.id, linkId);
    const audit = await installLinkWriteAudit(tableName, columnName);
    try {
      const ids = [first.id, second.id];
      const inputs = [first.id, ids, { id: first.id }, ids.map((id) => ({ id }))];
      const records = await postWrite('createRecords', {
        tableId: source.id,
        records: inputs.map((value) => ({ fields: { [linkId]: value } })),
      });
      const writes = await audit.read();
      const firstLink = { id: first.id, title: '$1000.50' };
      const bothLinks = [firstLink, { id: second.id, title: '$2.00' }];
      const firstWrites = records.map(({ id }) => writes.find((row) => row.record_id === id));
      expect(firstWrites.map((row) => row?.link_value)).toEqual([
        [firstLink],
        bothLinks,
        [firstLink],
        bothLinks,
      ]);
    } finally {
      await audit.dispose();
    }
  });
});
