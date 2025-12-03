/* eslint-disable sonarjs/no-identical-functions */
/* eslint-disable no-useless-escape */
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
  createRecords,
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

async function waitForFormulaText(
  tableId: string,
  fieldId: string,
  expectedValue: string,
  timeoutMs = 15000
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

  describe('create formula should avoid generated meta', () => {
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

    it('does not persist generated-column meta for supported expression on create', async () => {
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

      const meta = parsePersistedMeta(fieldRaw.meta);
      expect(meta?.persistedAsGeneratedColumn).not.toBe(true);
    });
  });

  describe('dateAdd should not be persisted as generated (immutability)', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'formula-meta-dateadd',
        fields: [{ name: 'Start Date', type: FieldType.Date }],
        records: [{ fields: { 'Start Date': '2024-01-10' } }],
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await deleteTable(baseId, table.id);
      }
    });

    it('stores persistedAsGeneratedColumn=false for DATE_ADD formulas', async () => {
      const startFieldId = table.fields.find((f) => f.name === 'Start Date')!.id;

      const created = await createField(table.id, {
        name: 'Start Minus 7',
        type: FieldType.Formula,
        options: {
          expression: `DATE_ADD({${startFieldId}},-7,\"day\")`,
          timeZone: 'Asia/Shanghai',
          formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'Asia/Shanghai' },
        },
      });

      const fieldRaw = await prisma.field.findUniqueOrThrow({
        where: { id: created.id },
        select: { meta: true },
      });

      const meta = parsePersistedMeta(fieldRaw.meta);
      expect(meta?.persistedAsGeneratedColumn).not.toBe(true);
    });
  });

  describe('datetime concatenation should not use generated column', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'formula-meta-datetime-concat',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          {
            name: 'Planned Time',
            type: FieldType.Date,
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'Asia/Shanghai' },
            },
          },
        ],
        records: [{ fields: { Title: 'Task', 'Planned Time': '2024-02-01 08:00' } }],
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await deleteTable(baseId, table.id);
      }
    });

    it('marks CONCATENATE with datetime args as non-generated and duplicates safely', async () => {
      const titleId = table.fields.find((f) => f.name === 'Title')!.id;
      const plannedId = table.fields.find((f) => f.name === 'Planned Time')!.id;

      const created = await createField(table.id, {
        name: 'Concat Formula',
        type: FieldType.Formula,
        options: {
          expression: `CONCATENATE({${titleId}}, {${plannedId}})`,
          timeZone: 'Asia/Shanghai',
        },
      });

      const createdRaw = await prisma.field.findUniqueOrThrow({
        where: { id: created.id },
        select: { meta: true },
      });
      expect(parsePersistedMeta(createdRaw.meta)?.persistedAsGeneratedColumn).not.toBe(true);

      const duplicated = await duplicateField(table.id, created.id, { name: 'Concat Copy' });
      const duplicatedRaw = await prisma.field.findUniqueOrThrow({
        where: { id: duplicated.data.id },
        select: { meta: true },
      });
      expect(parsePersistedMeta(duplicatedRaw.meta)?.persistedAsGeneratedColumn).not.toBe(true);
    });
  });

  describe('user concat formulas avoid generated columns', () => {
    let table: ITableFullVo;
    const userId = globalThis.testConfig.userId;
    const userName = globalThis.testConfig.userName;
    const statusOption = { id: 'status-work', name: 'On Duty' };

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'formula-meta-user-concat',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          {
            name: 'User',
            type: FieldType.User,
            options: { isMultiple: false, shouldNotify: false },
          },
          {
            name: 'Status',
            type: FieldType.SingleSelect,
            options: { choices: [statusOption] },
          },
        ],
        records: [],
      });

      await createRecords(table.id, {
        records: [
          {
            fields: {
              [table.fields.find((f) => f.name === 'Title')!.id]: 'Row 1',
              [table.fields.find((f) => f.name === 'User')!.id]: {
                id: userId,
                title: userName,
              },
              [table.fields.find((f) => f.name === 'Status')!.id]: statusOption,
            },
          },
        ],
        typecast: true,
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await deleteTable(baseId, table.id);
      }
    });

    it.skip('creates and duplicates without generated-column meta', async () => {
      const userFieldId = table.fields.find((f) => f.name === 'User')!.id;
      const statusFieldId = table.fields.find((f) => f.name === 'Status')!.id;
      const expression = `{${userFieldId}} & "-" & {${statusFieldId}}`;

      const created = await createField(table.id, {
        name: 'Title Formula',
        type: FieldType.Formula,
        options: { expression },
      });

      await waitForFormulaText(table.id, created.id, `${userName}-${statusOption.name}`);

      const createdRaw = await prisma.field.findUniqueOrThrow({
        where: { id: created.id },
        select: { meta: true },
      });
      expect(parsePersistedMeta(createdRaw.meta)?.persistedAsGeneratedColumn).not.toBe(true);

      const duplicated = await duplicateField(table.id, created.id, { name: 'Title Formula Copy' });
      const duplicatedRaw = await prisma.field.findUniqueOrThrow({
        where: { id: duplicated.data.id },
        select: { meta: true },
      });
      expect(parsePersistedMeta(duplicatedRaw.meta)?.persistedAsGeneratedColumn).not.toBe(true);

      await waitForFormulaText(table.id, duplicated.data.id, `${userName}-${statusOption.name}`);
    });
  });

  describe('convert to formula should avoid generated meta', () => {
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

    it('does not set generated-column meta when converting text->formula', async () => {
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

      const meta = parsePersistedMeta(fieldRaw.meta);
      expect(meta?.persistedAsGeneratedColumn).not.toBe(true);
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
      const createdMeta = parsePersistedMeta(createdRaw.meta);
      expect(createdMeta?.persistedAsGeneratedColumn).not.toBe(true);

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
      const updatedMeta = parsePersistedMeta(updatedRaw.meta);
      expect(updatedMeta?.persistedAsGeneratedColumn).not.toBe(true);
    });
  });

  describe('generated formula duplication tolerates text that is not numeric', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'formula-meta-duplicate-text',
        fields: [{ name: 'A', type: FieldType.SingleLineText }],
        records: [{ fields: { A: '45629' } }, { fields: { A: '2024/12/03' } }],
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await deleteTable(baseId, table.id);
      }
    });

    const waitForCopyValues = async (fieldId: string, timeoutMs = 15000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const records = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
        const recs = records.records ?? [];
        if (recs.every((r) => r.fields && r.fields[fieldId] !== undefined)) {
          return recs;
        }
        await sleep(200);
      }
      throw new Error('Timed out waiting for duplicated formula values');
    };

    it.skip('duplicates without throwing even when the base text cannot cast to numeric', async () => {
      const aId = table.fields.find((f) => f.name === 'A')!.id;

      const formula = await createField(table.id, {
        name: 'Generated Formula',
        type: FieldType.Formula,
        options: {
          expression: `IF(INT({${aId}}), DATE_ADD("1990-01-01", ROUND({${aId}}), "day"), {${aId}})`,
          timeZone: 'Asia/Shanghai',
        },
      });

      const duplicateRes = await duplicateField(table.id, formula.id, { name: 'Generated Copy' });
      const copyId = duplicateRes.data.id;

      const records = await waitForCopyValues(copyId);
      const originalValues = records.map((r) => r.fields?.[formula.id]);
      const copyValues = records.map((r) => r.fields?.[copyId]);

      expect(copyValues).toEqual(originalValues);
      expect(copyValues[1]).toBe('2024/12/03');
      expect(String(copyValues[0])).toMatch(/2114-12-0[56]/);
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
      expect(parsePersistedMeta(createdRaw.meta)?.persistedAsGeneratedColumn).not.toBe(true);

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
      expect(parsePersistedMeta(duplicateRaw.meta)?.persistedAsGeneratedColumn).not.toBe(true);

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
