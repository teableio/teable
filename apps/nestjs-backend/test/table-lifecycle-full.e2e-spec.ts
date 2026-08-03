/*
  A comprehensive end-to-end test that exercises a full table lifecycle:
  - Create tables
  - Create and update columns (including formulas)
  - Create link fields for all relationship types (MM/MO/OM/OO)
  - Create lookup and rollup
  - CRUD on records with link data
  - Verify cascading effects on computed fields
  - Verify underlying DB has expected columns and values
  - Verify API getRecords returns detailed expected results
  - Clean up by permanently deleting tables
*/
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import type { IFieldRo, IFieldVo } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { Knex } from 'knex';
import { DB_PROVIDER_SYMBOL } from '../src/db-provider/db.provider';
import type { IDbProvider } from '../src/db-provider/db.provider.interface';
import {
  createField,
  createRecords,
  createTable,
  deleteRecord,
  getFields,
  getRecord,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateRecord,
  updateRecordByApi,
  convertField,
} from './utils/init-app';

describe('Table Lifecycle Comprehensive (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let knex: Knex;
  let db: IDbProvider;
  const baseId = (globalThis as any).testConfig.baseId as string;

  const getDbTableName = async (tableId: string) => {
    const { dbTableName } = await prisma.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return dbTableName;
  };

  const getRow = async (dbTableName: string, id: string) => {
    return (
      await prisma.$queryRawUnsafe<any[]>(knex(dbTableName).select('*').where('__id', id).toQuery())
    )[0];
  };

  const getUserColumns = async (dbTableName: string) => {
    const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(db.columnInfo(dbTableName));
    // keep all user columns except preserved
    const { preservedDbFieldNames } = await import('../src/features/field/constant');
    return rows.map((r) => r.name).filter((n) => !preservedDbFieldNames.has(n));
  };

  const parseMaybe = (v: unknown) => {
    if (typeof v === 'string') {
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    }
    return v;
  };

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    prisma = app.get(PrismaService);
    knex = app.get('CUSTOM_KNEX' as any);
    db = app.get<IDbProvider>(DB_PROVIDER_SYMBOL as any);
  });

  afterAll(async () => {
    await app.close();
  });

  it('complete lifecycle from create to delete with detailed expectations', async () => {
    // 1) Create two tables: Host(A) and Foreign(B)
    const tableA = await createTable(baseId, { name: 'lifecycle_A' });
    const tableB = await createTable(baseId, {
      name: 'lifecycle_B',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'UnitPrice', type: FieldType.Number },
        { name: 'Stock', type: FieldType.Number },
      ] as IFieldRo[],
      records: [
        { fields: { Title: 'P1', UnitPrice: 100, Stock: 5 } },
        { fields: { Title: 'P2', UnitPrice: 50, Stock: 7 } },
      ],
    });

    expect(tableA.id).toBeDefined();
    expect(tableB.id).toBeDefined();

    const aDb = await getDbTableName(tableA.id);
    const bDb = await getDbTableName(tableB.id);
    expect(typeof aDb).toBe('string');
    expect(typeof bDb).toBe('string');

    // 2) Create columns on A: Qty(Number), PriceLocal(Number), Date(Date), Flag(Checkbox)
    const fQty = await createField(tableA.id, { name: 'Qty', type: FieldType.Number } as IFieldRo);
    const fPriceLocal = await createField(tableA.id, {
      name: 'PriceLocal',
      type: FieldType.Number,
    } as IFieldRo);
    const fDate = await createField(tableA.id, { name: 'Date', type: FieldType.Date } as IFieldRo);
    const fFlag = await createField(tableA.id, {
      name: 'Flag',
      type: FieldType.Checkbox,
    } as IFieldRo);

    // 3) Link fields on A covering all relationship types to B
    const lMM = await createField(tableA.id, {
      name: 'L_MM',
      type: FieldType.Link,
      options: { relationship: Relationship.ManyMany, foreignTableId: tableB.id },
    } as IFieldRo);
    const lMO = await createField(tableA.id, {
      name: 'L_MO',
      type: FieldType.Link,
      options: { relationship: Relationship.ManyOne, foreignTableId: tableB.id },
    } as IFieldRo);
    const lOM = await createField(tableA.id, {
      name: 'L_OM',
      type: FieldType.Link,
      options: { relationship: Relationship.OneMany, foreignTableId: tableB.id },
    } as IFieldRo);
    const lOO = await createField(tableA.id, {
      name: 'L_OO',
      type: FieldType.Link,
      options: { relationship: Relationship.OneOne, foreignTableId: tableB.id },
    } as IFieldRo);

    // 4) Lookup and Rollup on A based on links to B
    const fLookupPrice = await createField(tableA.id, {
      name: 'LookupPrice',
      type: FieldType.Number,
      isLookup: true,
      lookupOptions: {
        foreignTableId: tableB.id,
        linkFieldId: (lMO as any).id,
        lookupFieldId: tableB.fields.find((f) => f.name === 'UnitPrice')!.id,
      } as any,
    } as any);

    const fRollupStock = await createField(tableA.id, {
      name: 'RollupStock',
      type: FieldType.Rollup,
      lookupOptions: {
        foreignTableId: tableB.id,
        linkFieldId: (lMM as any).id,
        lookupFieldId: tableB.fields.find((f) => f.name === 'Stock')!.id,
      } as any,
      options: { expression: 'sum({values})' } as any,
    } as any);

    // 5) Formula fields: simple (likely generated) and referencing lookup (non-generated-ish)
    const fTotalLocal = await createField(tableA.id, {
      name: 'F_TotalLocal',
      type: FieldType.Formula,
      options: { expression: `{${(fQty as any).id}} * {${(fPriceLocal as any).id}}` },
    } as IFieldRo);
    const fCombined = await createField(tableA.id, {
      name: 'F_Combined',
      type: FieldType.Formula,
      options: { expression: `{${(fTotalLocal as any).id}} + {${(fLookupPrice as any).id}}` },
    } as IFieldRo);

    // Verify physical columns were created for new fields on A
    const aCols = await getUserColumns(aDb);
    const expectedCols = [
      (fQty as any).dbFieldName,
      (fPriceLocal as any).dbFieldName,
      (fDate as any).dbFieldName,
      (fFlag as any).dbFieldName,
      (lMM as any).dbFieldName,
      (lMO as any).dbFieldName,
      (lOM as any).dbFieldName,
      (lOO as any).dbFieldName,
      (fLookupPrice as any).dbFieldName,
      (fRollupStock as any).dbFieldName,
      (fTotalLocal as any).dbFieldName,
      (fCombined as any).dbFieldName,
    ];
    for (const c of expectedCols) expect(aCols).toContain(c);

    // 6) Create/Update records on A; include link data
    // Use the default 3 records from A; set values for first two
    const aRec1 = tableA.records[0].id;
    const aRec2 = tableA.records[1].id;
    const bRec1 = tableB.records[0].id; // P1
    const bRec2 = tableB.records[1].id; // P2

    // Set Qty=2, PriceLocal=80, links: MO=P1, MM=[P1,P2], OM=[P2], OO=P2
    await updateRecord(tableA.id, aRec1, {
      record: {
        fields: {
          [(fQty as any).id]: 2,
          [(fPriceLocal as any).id]: 80,
          [(lMO as any).id]: { id: bRec1 },
          [(lMM as any).id]: [{ id: bRec1 }, { id: bRec2 }],
          [(lOM as any).id]: [{ id: bRec2 }],
          [(lOO as any).id]: { id: bRec2 },
        },
      },
      fieldKeyType: FieldKeyType.Id,
    });

    // Second record: Qty=3, PriceLocal=120, MO=P2, MM=[P2]
    await updateRecord(tableA.id, aRec2, {
      record: {
        fields: {
          [(fQty as any).id]: 3,
          [(fPriceLocal as any).id]: 120,
          [(lMO as any).id]: { id: bRec2 },
          [(lMM as any).id]: [{ id: bRec2 }],
        },
      },
      fieldKeyType: FieldKeyType.Id,
    });

    // 7) Verify getRecords for A with detailed expectations
    const { records: aRecords0 } = await getRecords(tableA.id, { fieldKeyType: FieldKeyType.Id });
    const rec1 = aRecords0.find((r) => r.id === aRec1)!;
    const rec2 = aRecords0.find((r) => r.id === aRec2)!;
    expect(rec1.fields[(fQty as any).id]).toEqual(2);
    expect(rec1.fields[(fPriceLocal as any).id]).toEqual(80);
    expect(rec1.fields[(lMO as any).id]).toMatchObject({ id: bRec1, title: expect.any(String) });
    expect(rec1.fields[(lMM as any).id]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: bRec1 }),
        expect.objectContaining({ id: bRec2 }),
      ])
    );
    expect(rec1.fields[(lOM as any).id]).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: bRec2 })])
    );
    expect(rec1.fields[(lOO as any).id]).toMatchObject({ id: bRec2, title: expect.any(String) });
    // lookup/rollup/formulas
    expect(rec1.fields[(fLookupPrice as any).id]).toEqual(100);
    expect(rec1.fields[(fRollupStock as any).id]).toEqual(5 + 7);
    expect(rec1.fields[(fTotalLocal as any).id]).toEqual(2 * 80);
    expect(rec1.fields[(fCombined as any).id]).toEqual(2 * 80 + 100);

    expect(rec2.fields[(fLookupPrice as any).id]).toEqual(50);
    expect(rec2.fields[(fRollupStock as any).id]).toEqual(7);
    expect(rec2.fields[(fTotalLocal as any).id]).toEqual(3 * 120);
    expect(rec2.fields[(fCombined as any).id]).toEqual(3 * 120 + 50);

    // 8) Verify DB row values on A for the first record
    const row1 = await getRow(aDb, aRec1);
    const cell = (field: IFieldVo) => parseMaybe((row1 as any)[(field as any).dbFieldName]);
    expect(cell(fQty)).toEqual(2);
    expect(cell(fPriceLocal)).toEqual(80);
    expect(Array.isArray(cell(lMM)) ? cell(lMM).map((v: any) => v.id) : []).toEqual(
      expect.arrayContaining([bRec1, bRec2])
    );
    // Computed fields (lookup/rollup/formula) are verified via API responses above.
    // Persisted DB row should reflect scalar/link values reliably.

    // 9) Update a column (formula) and verify recomputation
    await convertField(tableA.id, (fTotalLocal as any).id, {
      name: (fTotalLocal as any).name,
      type: FieldType.Formula,
      options: { expression: `{${(fQty as any).id}} * 2` },
    } as IFieldRo);

    // Also update Qty to see cascade reflected in formula and combined
    await updateRecord(tableA.id, aRec1, {
      record: { fields: { [(fQty as any).id]: 5 } },
      fieldKeyType: FieldKeyType.Id,
    });

    const recAfterFormula = await getRecord(tableA.id, aRec1);
    expect(recAfterFormula.fields[(fTotalLocal as any).id]).toEqual(5 * 2);
    // F_Combined references F_TotalLocal + LookupPrice -> 10 + 100 = 110
    expect(recAfterFormula.fields[(fCombined as any).id]).toEqual(10 + 100);

    // Persisted DB values for computed fields may not be stored; rely on API checks for those.

    // 10) Update linked foreign values & link sets; validate cascading effects
    // Change B.P1 UnitPrice from 100 -> 150; affects LookupPrice and Combined on rec1
    const bUnitPrice = tableB.fields.find((f) => f.name === 'UnitPrice')!;
    await updateRecord(tableB.id, bRec1, {
      record: { fields: { [bUnitPrice.id]: 150 } },
      fieldKeyType: FieldKeyType.Id,
    });

    const recAfterForeignChange = await getRecord(tableA.id, aRec1);
    expect(recAfterForeignChange.fields[(fLookupPrice as any).id]).toEqual(150);
    expect(recAfterForeignChange.fields[(fCombined as any).id]).toEqual(10 + 150);

    // Remove P2 from L_MM, rollup should become 5
    await updateRecord(tableA.id, aRec1, {
      record: { fields: { [(lMM as any).id]: [{ id: bRec1 }] } },
      fieldKeyType: FieldKeyType.Id,
    });
    const recAfterLinkChange = await getRecord(tableA.id, aRec1);
    expect(recAfterLinkChange.fields[(fRollupStock as any).id]).toEqual(5);

    // 11) Record CRUD with link data
    // Create a new record with link + scalar values
    const created = await createRecords(tableA.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: {
            [(fQty as any).id]: 4,
            [(fPriceLocal as any).id]: 50,
            [(lMO as any).id]: { id: bRec2 },
            [(lMM as any).id]: [{ id: bRec2 }],
          },
        },
      ],
    });
    const newId = created.records[0].id;
    const newRec = await getRecord(tableA.id, newId);
    expect(newRec.fields[(fQty as any).id]).toEqual(4);
    expect(newRec.fields[(fLookupPrice as any).id]).toEqual(50);
    expect(newRec.fields[(fRollupStock as any).id]).toEqual(7);

    // Update the new record's link to include P1 as well; rollup should be 5 + 7 = 12
    await updateRecord(tableA.id, newId, {
      record: { fields: { [(lMM as any).id]: [{ id: bRec2 }, { id: bRec1 }] } },
      fieldKeyType: FieldKeyType.Id,
    });
    const newRec2 = await getRecord(tableA.id, newId);
    expect(newRec2.fields[(fRollupStock as any).id]).toEqual(12);

    // Delete the new record
    await deleteRecord(tableA.id, newId, 200);
    await getRecord(tableA.id, newId, undefined, 404);

    // 12) Update record by API for link/object shape (OneOne)
    await updateRecordByApi(tableA.id, aRec2, (lOO as any).id, { id: bRec1 });
    const rec2b = await getRecord(tableA.id, aRec2);
    expect(rec2b.fields[(lOO as any).id]).toMatchObject({ id: bRec1 });

    // 13) Final DB inspection (spot check) and fields listing
    const fieldsA = await getFields(tableA.id);
    const names = fieldsA.map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Qty',
        'PriceLocal',
        'L_MM',
        'L_MO',
        'L_OM',
        'L_OO',
        'LookupPrice',
        'RollupStock',
        'F_TotalLocal',
        'F_Combined',
      ])
    );

    // Spot check scalar persistence on another record
    const row2 = await getRow(aDb, aRec2);
    expect(parseMaybe((row2 as any)[(fQty as any).dbFieldName])).toEqual(3);

    // 14) Clean up: permanently delete tables
    await permanentDeleteTable(baseId, tableA.id);
    await permanentDeleteTable(baseId, tableB.id);
  });
});
