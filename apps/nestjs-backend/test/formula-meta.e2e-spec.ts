/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import { duplicateField } from '@teable/openapi';
import {
  createField,
  createTable,
  deleteTable,
  convertField,
  initApp,
  getRecords,
} from './utils/init-app';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForFormulaValue(
  tableId: string,
  fieldId: string,
  expectedValue: number,
  timeoutMs = 8000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const records = await getRecords(tableId, { fieldKeyType: FieldKeyType.Id });
    const value = records.records?.[0]?.fields?.[fieldId];
    if (value === expectedValue) {
      return;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for formula value ${expectedValue}`);
}

const parsePersistedMeta = (raw: unknown): { persistedAsGeneratedColumn?: boolean } | undefined => {
  if (!raw) {
    return undefined;
  }
  if (typeof raw === 'string') {
    return JSON.parse(raw) as { persistedAsGeneratedColumn?: boolean };
  }
  if (typeof raw === 'object') {
    return raw as { persistedAsGeneratedColumn?: boolean };
  }
  return undefined;
};

describe('Formula meta persistedAsGeneratedColumn (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('create formula should persist meta', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'formula-meta-create',
        fields: [{ name: 'Number Field', type: FieldType.Number }],
        records: [{ fields: { 'Number Field': 10 } }, { fields: { 'Number Field': 20 } }],
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await deleteTable(baseId, table.id);
      }
    });

    it('persists meta.persistedAsGeneratedColumn=true for supported expression on create', async () => {
      const numberFieldId = table.fields.find((f) => f.name === 'Number Field')!.id;

      const created = await createField(table.id, {
        name: 'Generated Formula',
        type: FieldType.Formula,
        options: { expression: `{${numberFieldId}} * 2` },
      });

      const fieldRaw = await prisma.field.findUniqueOrThrow({
        where: { id: created.id },
        select: { meta: true },
      });

      const meta = fieldRaw.meta ? JSON.parse(fieldRaw.meta as unknown as string) : undefined;
      expect(meta).toBeDefined();
      // expression is simple and supported as generated column across providers
      expect(meta.persistedAsGeneratedColumn).toBe(true);
    });
  });

  describe('convert to formula should persist meta', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'formula-meta-convert',
        fields: [
          { name: 'Text Field', type: FieldType.SingleLineText },
          { name: 'Number Field', type: FieldType.Number },
        ],
        records: [
          { fields: { 'Text Field': 'a', 'Number Field': 1 } },
          { fields: { 'Text Field': 'b', 'Number Field': 2 } },
        ],
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await deleteTable(baseId, table.id);
      }
    });

    it('persists meta.persistedAsGeneratedColumn=true when converting text->formula with supported expression', async () => {
      const textFieldId = table.fields.find((f) => f.name === 'Text Field')!.id;
      const numberFieldId = table.fields.find((f) => f.name === 'Number Field')!.id;

      await convertField(table.id, textFieldId, {
        type: FieldType.Formula,
        options: { expression: `{${numberFieldId}} * 2` },
      });

      const fieldRaw = await prisma.field.findUniqueOrThrow({
        where: { id: textFieldId },
        select: { meta: true },
      });

      const meta = fieldRaw.meta ? JSON.parse(fieldRaw.meta as unknown as string) : undefined;
      expect(meta).toBeDefined();
      expect(meta.persistedAsGeneratedColumn).toBe(true);
    });
  });

  describe('numeric generated formulas', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'formula-meta-numeric',
        fields: [{ name: 'Remaining Minutes', type: FieldType.Number }],
        records: [{ fields: { 'Remaining Minutes': 120 } }],
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await deleteTable(baseId, table.id);
      }
    });

    it('supports creating and updating generated numeric formulas', async () => {
      const minutesFieldId = table.fields.find((f) => f.name === 'Remaining Minutes')!.id;

      const created = await createField(table.id, {
        name: 'Hours Remaining',
        type: FieldType.Formula,
        options: {
          expression: `({${minutesFieldId}} * 45) / 60`,
        },
      });

      expect(created.hasError).toBeFalsy();
      await waitForFormulaValue(table.id, created.id, 90);

      const createdRaw = await prisma.field.findUniqueOrThrow({
        where: { id: created.id },
        select: { meta: true },
      });
      const createdMeta = createdRaw.meta
        ? (JSON.parse(createdRaw.meta as unknown as string) as {
            persistedAsGeneratedColumn?: boolean;
          })
        : undefined;
      expect(createdMeta?.persistedAsGeneratedColumn).toBe(true);

      const updated = await convertField(table.id, created.id, {
        type: FieldType.Formula,
        options: {
          expression: `({${minutesFieldId}} * 30) / 60`,
        },
      });

      expect(updated.id).toBe(created.id);
      expect(updated.hasError).toBeFalsy();
      await waitForFormulaValue(table.id, created.id, 60);

      const updatedRaw = await prisma.field.findUniqueOrThrow({
        where: { id: created.id },
        select: { meta: true },
      });
      const updatedMeta = updatedRaw.meta
        ? (JSON.parse(updatedRaw.meta as unknown as string) as {
            persistedAsGeneratedColumn?: boolean;
          })
        : undefined;
      expect(updatedMeta?.persistedAsGeneratedColumn).toBe(true);
    });
  });

  describe('formula metadata resets when expressions become unsupported', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'formula-meta-reset',
        fields: [
          { name: 'Number Field', type: FieldType.Number },
          { name: 'Text Field', type: FieldType.SingleLineText },
        ],
        records: [{ fields: { 'Number Field': 5, 'Text Field': 'text' } }],
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await deleteTable(baseId, table.id);
      }
    });

    it('clears persisted meta when converting generated formula to unsupported expression', async () => {
      const numberFieldId = table.fields.find((f) => f.name === 'Number Field')!.id;
      const textFieldId = table.fields.find((f) => f.name === 'Text Field')!.id;

      const created = await createField(table.id, {
        name: 'Generated Numeric',
        type: FieldType.Formula,
        options: { expression: `{${numberFieldId}} * 2` },
      });

      const createdRaw = await prisma.field.findUniqueOrThrow({
        where: { id: created.id },
        select: { meta: true },
      });
      expect(parsePersistedMeta(createdRaw.meta)?.persistedAsGeneratedColumn).toBe(true);

      await convertField(table.id, created.id, {
        type: FieldType.Formula,
        options: { expression: `AND({${numberFieldId}}, {${textFieldId}})` },
      });

      const updatedRaw = await prisma.field.findUniqueOrThrow({
        where: { id: created.id },
        select: { meta: true },
      });
      expect(parsePersistedMeta(updatedRaw.meta)?.persistedAsGeneratedColumn).not.toBe(true);
      expect(updatedRaw.meta).toBeNull();
    });

    it('removes copied persisted meta for duplicated formulas after unsupported update', async () => {
      const numberFieldId = table.fields.find((f) => f.name === 'Number Field')!.id;
      const textFieldId = table.fields.find((f) => f.name === 'Text Field')!.id;

      const created = await createField(table.id, {
        name: 'Generated Base Formula',
        type: FieldType.Formula,
        options: { expression: `{${numberFieldId}} + 1` },
      });

      const duplicateRes = await duplicateField(table.id, created.id, { name: 'Generated Copy' });
      const duplicatedField = duplicateRes.data;

      const duplicateRaw = await prisma.field.findUniqueOrThrow({
        where: { id: duplicatedField.id },
        select: { meta: true },
      });
      expect(parsePersistedMeta(duplicateRaw.meta)?.persistedAsGeneratedColumn).toBe(true);

      await convertField(table.id, duplicatedField.id, {
        type: FieldType.Formula,
        options: { expression: `AND({${numberFieldId}}, {${textFieldId}})` },
      });

      const postUpdateRaw = await prisma.field.findUniqueOrThrow({
        where: { id: duplicatedField.id },
        select: { meta: true },
      });
      expect(parsePersistedMeta(postUpdateRaw.meta)?.persistedAsGeneratedColumn).not.toBe(true);
      expect(postUpdateRaw.meta).toBeNull();
    });
  });
});
