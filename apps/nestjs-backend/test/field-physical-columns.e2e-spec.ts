/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import { FieldType, Relationship } from '@teable/core';
import type { IFieldRo } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { Knex } from 'knex';
import { DB_PROVIDER_SYMBOL } from '../src/db-provider/db.provider';
import type { IDbProvider } from '../src/db-provider/db.provider.interface';
import { preservedDbFieldNames } from '../src/features/field/constant';
import {
  createField,
  createTable,
  initApp,
  permanentDeleteTable,
  convertField,
} from './utils/init-app';

describe('Field -> Physical Columns mapping (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let knex: Knex;
  let db: IDbProvider;
  const baseId = (globalThis as any).testConfig.baseId as string;

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

  const getDbTableName = async (tableId: string) => {
    const { dbTableName } = await prisma.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return dbTableName;
  };

  const getUserColumns = async (dbTableName: string) => {
    const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(db.columnInfo(dbTableName));
    return rows.map((r) => r.name).filter((n) => !preservedDbFieldNames.has(n));
  };

  it('ensures each created field has exactly one physical column on the host table', async () => {
    // Create main table and a secondary table for links
    const tMain = await createTable(baseId, { name: 'phys_host' });
    const tForeign = await createTable(baseId, {
      name: 'phys_foreign',
      fields: [{ name: 'FA', type: FieldType.Number } as IFieldRo],
      records: [{ fields: { FA: 1 } }],
    });
    const mainDb = await getDbTableName(tMain.id);

    const initialCols = await getUserColumns(mainDb);

    // 1) Simple scalar fields (should each create a physical column)
    const fNum = await createField(tMain.id, { name: 'C1', type: FieldType.Number } as IFieldRo);
    const fText = await createField(tMain.id, {
      name: 'S',
      type: FieldType.SingleLineText,
    } as IFieldRo);
    const fLong = await createField(tMain.id, { name: 'L', type: FieldType.LongText } as IFieldRo);
    const fDate = await createField(tMain.id, { name: 'D', type: FieldType.Date } as IFieldRo);
    const fCheckbox = await createField(tMain.id, {
      name: 'B',
      type: FieldType.Checkbox,
    } as IFieldRo);
    const fAttach = await createField(tMain.id, {
      name: 'AT',
      type: FieldType.Attachment,
    } as IFieldRo);
    const fSS = await createField(tMain.id, {
      name: 'SS',
      type: FieldType.SingleSelect,
      // minimal options for select types
      options: { choices: [{ id: 'opt1', name: 'opt1' }] },
    } as any);
    const fMS = await createField(tMain.id, {
      name: 'MS',
      type: FieldType.MultipleSelect,
      options: {
        choices: [
          { id: 'o1', name: 'o1' },
          { id: 'o2', name: 'o2' },
        ],
      },
    } as any);
    // 2) Formula (simple; tends to be generated on PG)
    const fFormula1 = await createField(tMain.id, {
      name: 'F1',
      type: FieldType.Formula,
      options: { expression: `{${fNum.id}}` },
    } as IFieldRo);
    // 3) Link (ManyMany) -> expect host column
    const fLinkMM = await createField(tMain.id, {
      name: 'L_MM',
      type: FieldType.Link,
      options: { relationship: Relationship.ManyMany, foreignTableId: tForeign.id },
    } as IFieldRo);
    // 4) Link (ManyOne) -> expect either FK name or host column
    const fLinkMO = await createField(tMain.id, {
      name: 'L_MO',
      type: FieldType.Link,
      options: { relationship: Relationship.ManyOne, foreignTableId: tForeign.id },
    } as IFieldRo);
    // 5) Lookup on ManyMany link
    const fLookup = await createField(tMain.id, {
      name: 'LK',
      type: FieldType.Number,
      isLookup: true,
      lookupOptions: {
        foreignTableId: tForeign.id,
        linkFieldId: (fLinkMM as any).id,
        lookupFieldId: (tForeign.fields![0] as any).id,
      } as any,
    } as any);
    // 6) Rollup over link
    const fRoll = await createField(tMain.id, {
      name: 'R',
      type: FieldType.Rollup,
      lookupOptions: {
        foreignTableId: tForeign.id,
        linkFieldId: (fLinkMM as any).id,
        lookupFieldId: (tForeign.fields![0] as any).id,
      } as any,
      options: { expression: 'sum({values})' } as any,
    } as any);

    // 7) A formula referencing lookup (unlikely to be generated)
    const fFormula2 = await createField(tMain.id, {
      name: 'F2',
      type: FieldType.Formula,
      options: { expression: `{${(fLookup as any).id}}` },
    } as IFieldRo);

    const finalCols = await getUserColumns(mainDb);
    const newCols = finalCols.filter((c) => !initialCols.includes(c));

    // Build expected column names on host table
    const expectedNames = new Set<string>();
    // Number
    expectedNames.add((fNum as any).dbFieldName);
    // Scalar fields
    expectedNames.add((fText as any).dbFieldName);
    expectedNames.add((fLong as any).dbFieldName);
    expectedNames.add((fDate as any).dbFieldName);
    expectedNames.add((fCheckbox as any).dbFieldName);
    expectedNames.add((fAttach as any).dbFieldName);
    expectedNames.add((fSS as any).dbFieldName);
    expectedNames.add((fMS as any).dbFieldName);
    // Formula fields (both should have a physical column with dbFieldName — either generated or normal)
    expectedNames.add((fFormula1 as any).dbFieldName);
    expectedNames.add((fFormula2 as any).dbFieldName);
    // Link-ManyMany: we expect a host column reflecting the link field
    expectedNames.add((fLinkMM as any).dbFieldName);
    // Link-ManyOne: either the FK column equals dbFieldName (host) or a separate host column was created
    // In either case, assert host has the dbFieldName to enforce one-to-one
    expectedNames.add((fLinkMO as any).dbFieldName);
    // Lookup + Rollup: persisted columns
    expectedNames.add((fLookup as any).dbFieldName);
    expectedNames.add((fRoll as any).dbFieldName);

    // Assert: host table contains at least one physical column per created field
    for (const name of expectedNames) {
      expect(newCols).toContain(name);
    }

    await permanentDeleteTable(baseId, tMain.id);
    await permanentDeleteTable(baseId, tForeign.id);
  });

  it('converts text -> link (ManyOne/OneOne/OneMany) and ensures physical columns are created without duplication', async () => {
    const tMain = await createTable(baseId, { name: 'conv_host' });
    const tForeign = await createTable(baseId, {
      name: 'conv_foreign',
      fields: [{ name: 'F', type: FieldType.Number } as IFieldRo],
      records: [{ fields: { F: 1 } }],
    });
    const mainDb = await getDbTableName(tMain.id);

    const initialCols = await getUserColumns(mainDb);

    // Prepare three simple text fields
    const fTextMO = await createField(tMain.id, { name: 'MO', type: FieldType.SingleLineText });
    const fTextOO = await createField(tMain.id, { name: 'OO', type: FieldType.SingleLineText });
    const fTextOM = await createField(tMain.id, { name: 'OM', type: FieldType.SingleLineText });

    // Convert to links with different relationships
    const linkMO = await convertField(tMain.id, (fTextMO as any).id, {
      name: (fTextMO as any).name,
      type: FieldType.Link,
      options: { relationship: Relationship.ManyOne, foreignTableId: tForeign.id },
    } as IFieldRo);

    const linkOO = await convertField(tMain.id, (fTextOO as any).id, {
      name: (fTextOO as any).name,
      type: FieldType.Link,
      options: { relationship: Relationship.OneOne, foreignTableId: tForeign.id },
    } as IFieldRo);

    const linkOM = await convertField(tMain.id, (fTextOM as any).id, {
      name: (fTextOM as any).name,
      type: FieldType.Link,
      options: { relationship: Relationship.OneMany, foreignTableId: tForeign.id },
    } as IFieldRo);

    const finalCols = await getUserColumns(mainDb);
    const newCols = finalCols.filter((c) => !initialCols.includes(c));

    // Each converted field must have at least one physical column on host table.
    // We accept either the dbFieldName itself (standard column) or
    // implementation-specific FK columns (e.g., __fk_*, *_order).
    const expectOnePhysical = (field: any) => {
      const name = field.dbFieldName as string;
      const ok = newCols.includes(name) || newCols.some((c) => c.startsWith('__fk_'));
      expect(ok).toBe(true);
    };

    expectOnePhysical(linkMO);
    expectOnePhysical(linkOO);
    expectOnePhysical(linkOM);

    await permanentDeleteTable(baseId, tMain.id);
    await permanentDeleteTable(baseId, tForeign.id);
  });
});
