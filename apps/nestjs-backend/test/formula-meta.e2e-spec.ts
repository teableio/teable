/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import { createField, createTable, deleteTable, convertField, initApp } from './utils/init-app';

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
});
