/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import {
  DateFormattingPreset,
  FieldKeyType,
  FieldType,
  SortFunc,
  TimeFormatting,
} from '@teable/core';
import type { ITableFullVo, ITableQueryIndexPolicyRo } from '@teable/openapi';
import { getTableQueryIndexPolicy, updateTableQueryIndexPolicy } from '@teable/openapi';
import { DatabaseRouter } from '../src/global/database-router.service';
import { createTable, getRecords, initApp, permanentDeleteTable } from './utils/init-app';

type PlanNode = {
  'Node Type': string;
  'Index Name'?: string;
  Plans?: PlanNode[];
};
const flattenPlan = (node: PlanNode): PlanNode[] => [
  node,
  ...(node.Plans ?? []).flatMap(flattenPlan),
];
const quoteIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

describe('OpenAPI table query index policy (e2e)', () => {
  let app: INestApplication;
  let table: ITableFullVo | undefined;
  let databaseRouter: DatabaseRouter;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    app = (await initApp()).app;
    databaseRouter = app.get(DatabaseRouter);
  });

  afterAll(async () => {
    if (table) await permanentDeleteTable(baseId, table.id);
    await app?.close();
  });

  it('persists a date DESC NULLS LAST + system auto-number policy and preserves paged record order', async () => {
    table = await createTable(baseId, {
      name: 'Query policy ordered date fixture',
      fields: [
        { name: 'Label', type: FieldType.SingleLineText },
        {
          name: 'Window start',
          type: FieldType.Date,
          options: {
            formatting: {
              date: DateFormattingPreset.ISO,
              time: TimeFormatting.None,
              timeZone: 'UTC',
            },
          },
        },
      ],
      records: [
        { fields: { Label: 'null-first-inserted' } },
        { fields: { Label: 'older', 'Window start': '2024-01-01T00:00:00.000Z' } },
        { fields: { Label: 'newer-first-tie', 'Window start': '2024-01-02T00:00:00.000Z' } },
        { fields: { Label: 'newer-second-tie', 'Window start': '2024-01-02T00:00:00.000Z' } },
        { fields: { Label: 'null-last-inserted' } },
      ],
    });
    const label = table.fields.find((field) => field.name === 'Label')!;
    const date = table.fields.find((field) => field.name === 'Window start')!;
    const policy: ITableQueryIndexPolicyRo = {
      indexes: [
        {
          id: 'window_order',
          columns: [
            { kind: 'field', fieldId: date.id, direction: 'desc', nulls: 'last' },
            { kind: 'field', fieldId: '__auto_number', direction: 'asc' },
          ],
        },
      ],
    };
    const orderBy = [
      { fieldId: date.id, order: SortFunc.Desc },
      { fieldId: '__auto_number', order: SortFunc.Asc },
    ];
    const expected = [
      'newer-first-tie',
      'newer-second-tie',
      'older',
      'null-first-inserted',
      'null-last-inserted',
    ];
    const readLabels = async (skip: number, take: number) => {
      const result = await getRecords(table!.id, {
        fieldKeyType: FieldKeyType.Id,
        orderBy,
        skip,
        take,
      });
      return result.records.map((record) => record.fields[label.id]);
    };
    expect(await readLabels(0, 5)).toEqual(expected);

    // Real HTTP validation used to reject __auto_number and/or strip nulls.
    const put = await updateTableQueryIndexPolicy(baseId, table.id, policy);
    expect(put.status).toBe(200);
    expect(put.data).toEqual({ version: 1, ...policy });
    expect((await getTableQueryIndexPolicy(baseId, table.id)).data).toEqual({
      version: 1,
      ...policy,
    });
    expect(await readLabels(0, 5)).toEqual(expected);
    expect([
      ...(await readLabels(0, 2)),
      ...(await readLabels(2, 2)),
      ...(await readLabels(4, 2)),
    ]).toEqual(expected);

    const [schemaName, physicalTable] = table.dbTableName.split('.');
    const indexes = await databaseRouter.queryDataPrismaForTable<
      { indexname: string; indexdef: string; options: string; columns: string[] }[]
    >(
      table.id,
      `SELECT c.relname AS indexname,pg_get_indexdef(i.indexrelid) AS indexdef,
        i.indoption::text AS options,
        ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum,ordinality)
          JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.ordinality) AS columns
       FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
       JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
       WHERE n.nspname=$1 AND t.relname=$2 AND c.relname LIKE 'idx_qry_%'`,
      schemaName,
      physicalTable
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0].columns).toEqual([date.dbFieldName, '__auto_number']);
    // pg_index.indoption bits: DESC=1, NULLS FIRST=2. DESC NULLS LAST must be 1, not 3.
    expect(indexes[0].options).toBe('1 0');
    expect(indexes[0].indexdef).toContain('DESC NULLS LAST');

    // A five-row table naturally prefers a sequential scan. This transaction-local
    // switch proves ordering capability, NOT natural plan selection or performance.
    const nodes = await databaseRouter.dataPrismaTransactionForTable(table.id, async (prisma) => {
      await prisma.$executeRawUnsafe('SET LOCAL enable_seqscan=off');
      const plans = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': { Plan: PlanNode }[] }[]>(
        `EXPLAIN (FORMAT JSON) SELECT "__id" FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(physicalTable)}
         ORDER BY ${quoteIdentifier(date.dbFieldName)} DESC NULLS LAST,"__auto_number" ASC LIMIT 3`
      );
      return flattenPlan(plans[0]['QUERY PLAN'][0].Plan);
    });
    expect(nodes.some((node) => node['Index Name'] === indexes[0].indexname)).toBe(true);
    expect(nodes.some((node) => node['Node Type'].includes('Sort'))).toBe(false);
  });
});
