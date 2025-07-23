import type { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  IFieldRo,
  IFieldVo,
  ILinkFieldOptions,
  ILinkFieldOptionsRo,
  ILookupOptionsRo,
} from '@teable/core';
import {
  Colors,
  DateFormattingPreset,
  DriverClient,
  FieldAIActionType,
  FieldType,
  NumberFormattingType,
  Relationship,
  SingleLineTextFieldCore,
  TimeFormatting,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import type { Knex } from 'knex';
import type { FieldCreateEvent } from '../src/event-emitter/events';
import { Events } from '../src/event-emitter/events';
import {
  createField,
  createTable,
  deleteField,
  permanentDeleteTable,
  getFields,
  getRecord,
  initApp,
  updateRecordByApi,
} from './utils/init-app';

describe('OpenAPI FieldController (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let event: EventEmitter2;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    event = app.get(EventEmitter2);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('CRUD', () => {
    let table1: ITableFullVo;

    beforeAll(async () => {
      table1 = await createTable(baseId, { name: 'table1' });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table1.id);
    });

    it('/api/table/{tableId}/field (GET)', async () => {
      const fields: IFieldVo[] = await getFields(table1.id);

      expect(fields).toHaveLength(3);
    });

    it('/api/table/{tableId}/field (GET) with projection', async () => {
      const firstFieldId = table1.fields[0].id;
      const firstViewId = table1.views[0].id;

      const fields: IFieldVo[] = await getFields(table1.id, undefined, undefined, [firstFieldId]);
      const viewFields: IFieldVo[] = await getFields(table1.id, firstViewId, undefined, [
        firstFieldId,
      ]);

      expect(fields).toHaveLength(1);
      expect(fields[0].id).toEqual(firstFieldId);

      expect(viewFields).toHaveLength(1);
      expect(viewFields[0].id).toEqual(firstFieldId);
    });

    it('/api/table/{tableId}/field (POST)', async () => {
      event.once(Events.TABLE_FIELD_CREATE, async (payload: FieldCreateEvent) => {
        expect(payload).toBeDefined();
        expect(payload?.payload).toBeDefined();
        expect(payload?.payload?.tableId).toBeDefined();
        expect(payload?.payload?.field).toBeDefined();
      });

      const fieldRo: IFieldRo = {
        name: 'New field',
        description: 'the new field',
        type: FieldType.SingleLineText,
        options: SingleLineTextFieldCore.defaultOptions(),
      };

      await createField(table1.id, fieldRo);

      const fields: IFieldVo[] = await getFields(table1.id);
      expect(fields).toHaveLength(4);
    });
  });

  describe('should generate default name and options for field', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;

    beforeAll(async () => {
      table1 = await createTable(baseId, { name: 'table1' });
      table2 = await createTable(baseId, { name: 'table2' });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    async function createFieldByType(
      type: FieldType,
      options?: IFieldRo['options']
    ): Promise<IFieldVo> {
      const fieldRo: IFieldRo = {
        type,
        options,
      };

      return await createField(table1.id, fieldRo);
    }
    it('basic field', async () => {
      const textField = await createFieldByType(FieldType.SingleLineText);
      expect(textField.name).toEqual('Label');
      expect(textField.options).toEqual({});

      const numberField = await createFieldByType(FieldType.Number);
      expect(numberField.name).toEqual('Number');
      expect(numberField.options).toEqual({
        formatting: { type: NumberFormattingType.Decimal, precision: 2 },
      });

      const selectField = await createFieldByType(FieldType.SingleSelect);
      expect(selectField.name).toEqual('Select');
      expect(selectField.options).toEqual({
        choices: [],
      });

      const datetimeField = await createFieldByType(FieldType.Date);
      expect(datetimeField.name).toEqual('Date');
      expect(datetimeField.options).toEqual({
        formatting: {
          date: DateFormattingPreset.ISO,
          time: TimeFormatting.None,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });

      const checkboxField = await createFieldByType(FieldType.Checkbox);
      expect(checkboxField.name).toEqual('Done');
      expect(checkboxField.options).toEqual({});

      const attachmentField = await createFieldByType(FieldType.Attachment);
      expect(attachmentField.name).toEqual('Attachments');
      expect(attachmentField.options).toEqual({});

      const buttonField = await createFieldByType(FieldType.Button);
      expect(buttonField.name).toEqual('Button');
      expect(buttonField.options).toEqual({
        label: 'Button',
        color: Colors.Teal,
      });
    });

    it('formula field', async () => {
      const stringFormulaField = await createFieldByType(FieldType.Formula, {
        expression: '"A"',
      });
      expect(stringFormulaField.name).toEqual('Calculation');
      expect(stringFormulaField.options).toEqual({
        expression: '"A"',
      });

      const numberFormulaField = await createFieldByType(FieldType.Formula, {
        expression: '1 + 1',
      });
      expect(numberFormulaField.options).toEqual({
        expression: '1 + 1',
        formatting: { type: NumberFormattingType.Decimal, precision: 2 },
      });

      const booleanFormulaField = await createFieldByType(FieldType.Formula, {
        expression: 'true',
      });
      expect(booleanFormulaField.options).toEqual({
        expression: 'true',
      });

      const datetimeField = await createFieldByType(FieldType.Date);
      const datetimeFormulaField = await createFieldByType(FieldType.Formula, {
        expression: `{${datetimeField.id}}`,
      });
      expect(datetimeFormulaField.options).toEqual({
        expression: `{${datetimeField.id}}`,
        formatting: {
          date: DateFormattingPreset.ISO,
          time: TimeFormatting.None,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
    });

    describe('relational field', () => {
      it('should generate semantic field name for link and lookup and rollup field ', async () => {
        const linkField = await createField(table1.id, {
          type: FieldType.Link,
          options: {
            foreignTableId: table2.id,
            relationship: Relationship.OneMany,
          } as ILinkFieldOptionsRo,
        });

        expect(linkField.name).toEqual(`${table2.name}`);
        table2.fields = await getFields(table2.id);
        const symmetricalLinkField = table2.fields.find((f) => f.type === FieldType.Link);

        expect(symmetricalLinkField?.name).toEqual(table1.name);
        const lookupField = await createField(table1.id, {
          type: FieldType.SingleLineText,
          lookupOptions: {
            foreignTableId: table2.id,
            lookupFieldId: table2.fields[0].id,
            linkFieldId: linkField.id,
          } as ILookupOptionsRo,
          isLookup: true,
        });

        expect(lookupField.name).toEqual(`${table2.fields[0].name} (from ${table2.name})`);
        expect(lookupField.options).toEqual({});

        const rollupField = await createField(table1.id, {
          type: FieldType.Rollup,
          options: {
            expression: 'sum({values})',
          },
          lookupOptions: {
            foreignTableId: table2.id,
            lookupFieldId: table2.fields[0].id,
            linkFieldId: linkField.id,
          } as ILookupOptionsRo,
        });

        expect(rollupField.name).toEqual(`${table2.fields[0].name} Rollup (from ${table2.name})`);
        expect(rollupField.options).toEqual({
          expression: 'sum({values})',
          formatting: { type: NumberFormattingType.Decimal, precision: 2 },
        });
      });
    });
  });

  describe('should decide whether to create field validation rules based on the field type', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;

    beforeAll(async () => {
      table1 = await createTable(baseId, { name: 'table1' });
      table2 = await createTable(baseId, { name: 'table2' });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    async function createFieldWithUnique(
      type: FieldType,
      options?: IFieldRo['options'],
      expectStatus = 201
    ): Promise<IFieldVo> {
      const fieldRo: IFieldRo = {
        type,
        unique: true,
        options,
      };

      return await createField(table1.id, fieldRo, expectStatus);
    }

    async function createFieldWithNotNull(
      type: FieldType,
      options?: IFieldRo['options'],
      expectStatus = 201
    ): Promise<IFieldVo> {
      const fieldRo: IFieldRo = {
        type,
        notNull: true,
        options,
      };

      return await createField(table1.id, fieldRo, expectStatus);
    }

    it('should create successfully for field ai config', async () => {
      const baseField = await createField(table1.id, { type: FieldType.SingleLineText }, 201);
      const fieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        aiConfig: {
          type: FieldAIActionType.Summary,
          modelKey: 'openai@gpt-4o@gpt',
          sourceFieldId: baseField.id,
        },
      };
      const aiField = await createField(table1.id, fieldRo, 201);
      expect(aiField.aiConfig).toEqual({
        type: FieldAIActionType.Summary,
        modelKey: 'openai@gpt-4o@gpt',
        sourceFieldId: baseField.id,
      });
    });

    it('should create fail for user field with ai config', async () => {
      const baseField = await createField(table1.id, { type: FieldType.SingleLineText }, 201);
      const fieldRo: IFieldRo = {
        type: FieldType.Attachment,
        aiConfig: {
          type: FieldAIActionType.Summary,
          modelKey: 'openai@gpt-4o@GPT',
          sourceFieldId: baseField.id,
        },
      };
      await createField(table1.id, fieldRo, 400);
    });

    it('should create successfully for a unique validation field with valid field types', async () => {
      const textField = await createFieldWithUnique(FieldType.SingleLineText);
      expect(textField.unique).toEqual(true);

      const longTextField = await createFieldWithUnique(FieldType.LongText);
      expect(longTextField.unique).toEqual(true);

      const numberField = await createFieldWithUnique(FieldType.Number);
      expect(numberField.unique).toEqual(true);

      const datetimeField = await createFieldWithUnique(FieldType.Date);
      expect(datetimeField.unique).toEqual(true);
    });

    it('should create fail for a unique validation field with invalid field types', async () => {
      await createFieldWithUnique(FieldType.Attachment, undefined, 400);

      await createFieldWithUnique(FieldType.User, undefined, 400);

      await createFieldWithUnique(FieldType.Checkbox, undefined, 400);

      await createFieldWithUnique(FieldType.SingleSelect, undefined, 400);

      await createFieldWithUnique(FieldType.MultipleSelect, undefined, 400);

      await createFieldWithUnique(FieldType.Rating, undefined, 400);

      await createFieldWithUnique(
        FieldType.Formula,
        {
          expression: '1 + 1',
        },
        400
      );

      await createFieldWithUnique(
        FieldType.Link,
        {
          foreignTableId: table2.id,
          relationship: Relationship.ManyOne,
        },
        400
      );

      const linkField = await createField(table1.id, {
        type: FieldType.Link,
        options: {
          foreignTableId: table2.id,
          relationship: Relationship.ManyOne,
        } as ILinkFieldOptionsRo,
      });

      await createFieldWithUnique(
        FieldType.Rollup,
        {
          options: {
            expression: 'SUM({values})',
          },
          lookupOptions: {
            foreignTableId: table2.id,
            lookupFieldId: table2.fields[0].id,
            linkFieldId: linkField.id,
          },
        },
        400
      );

      await createFieldWithUnique(FieldType.CreatedTime, undefined, 400);

      await createFieldWithUnique(FieldType.LastModifiedTime, undefined, 400);

      await createFieldWithUnique(FieldType.AutoNumber, undefined, 400);
    });

    it.skipIf(globalThis.testConfig.driver === DriverClient.Sqlite)(
      'should create fail for a not null validation field with all field types',
      async () => {
        await createFieldWithNotNull(FieldType.SingleLineText, undefined, 400);

        await createFieldWithNotNull(FieldType.LongText, undefined, 400);

        await createFieldWithNotNull(FieldType.Number, undefined, 400);

        await createFieldWithNotNull(FieldType.Date, undefined, 400);

        await createFieldWithNotNull(FieldType.User, undefined, 400);

        await createFieldWithNotNull(FieldType.Checkbox, undefined, 400);

        await createFieldWithNotNull(FieldType.SingleSelect, undefined, 400);

        await createFieldWithNotNull(FieldType.MultipleSelect, undefined, 400);

        await createFieldWithNotNull(FieldType.Rating, undefined, 400);

        await createFieldWithNotNull(
          FieldType.Formula,
          {
            expression: '1 + 1',
          },
          400
        );

        await createFieldWithNotNull(
          FieldType.Link,
          {
            foreignTableId: table2.id,
            relationship: Relationship.ManyOne,
          },
          400
        );

        const linkField = await createField(table1.id, {
          type: FieldType.Link,
          options: {
            foreignTableId: table2.id,
            relationship: Relationship.ManyOne,
          } as ILinkFieldOptionsRo,
        });

        await createFieldWithNotNull(
          FieldType.Rollup,
          {
            options: {
              expression: 'SUM({values})',
            },
            lookupOptions: {
              foreignTableId: table2.id,
              lookupFieldId: table2.fields[0].id,
              linkFieldId: linkField.id,
            },
          },
          400
        );

        await createFieldWithNotNull(FieldType.CreatedTime, undefined, 400);

        await createFieldWithNotNull(FieldType.LastModifiedTime, undefined, 400);

        await createFieldWithNotNull(FieldType.AutoNumber, undefined, 400);
      }
    );
  });

  describe('should safe delete field', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;

    beforeAll(async () => {
      table1 = await createTable(baseId, { name: 'table1' });
      table2 = await createTable(baseId, { name: 'table2' });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    let prisma: PrismaService;
    let knex: Knex;

    beforeAll(async () => {
      prisma = app.get(PrismaService);
      knex = app.get('CUSTOM_KNEX');
    });

    it('should delete a simple field', async () => {
      const fieldRo: IFieldRo = {
        name: 'New field',
        description: 'the new field',
        type: FieldType.SingleLineText,
        options: SingleLineTextFieldCore.defaultOptions(),
      };
      const field = await createField(table1.id, fieldRo);
      await deleteField(table1.id, field.id);
      const fieldRaw = await prisma.field.findUnique({
        where: { id: field.id },
      });
      expect(fieldRaw?.deletedTime).toBeTruthy();
    });

    it('should forbid to delete a primary field', async () => {
      const fields = await prisma.field.findMany({
        where: { tableId: table1.id },
      });

      const primaryFieldId = fields.find((f) => f.isPrimary)?.id as string;
      const fn = async () => await deleteField(table1.id, primaryFieldId);
      await expect(fn()).rejects.toMatchObject({
        status: 403,
      });
    });

    it('should delete a formula dependency field, a -> b delete a', async () => {
      const textFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        options: SingleLineTextFieldCore.defaultOptions(),
      };
      const textField = await createField(table1.id, textFieldRo);
      const formulaFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${textField.id}}`,
        },
      };
      const formulaField = await createField(table1.id, formulaFieldRo);

      const referenceBefore = await prisma.reference.findMany({
        where: { fromFieldId: textField.id },
      });
      expect(referenceBefore.length).toBe(1);
      expect(referenceBefore[0].toFieldId).toBe(formulaField.id);

      await deleteField(table1.id, textField.id);
      // reference should be deleted
      const referenceAfter = await prisma.reference.findFirst({
        where: { fromFieldId: textField.id },
      });
      expect(referenceAfter).toBeFalsy();

      // text field should be deleted
      const fieldRaw = await prisma.field.findUnique({
        where: { id: textField.id },
      });
      expect(fieldRaw?.deletedTime).toBeTruthy();
    });

    it('should delete a formula field, a -> b delete b', async () => {
      const textFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        options: SingleLineTextFieldCore.defaultOptions(),
      };
      const textField = await createField(table1.id, textFieldRo);
      const formulaFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${textField.id}}`,
        },
      };
      const formulaField = await createField(table1.id, formulaFieldRo);

      const referenceBefore = await prisma.reference.findMany({
        where: { toFieldId: formulaField.id },
      });
      expect(referenceBefore.length).toBe(1);
      expect(referenceBefore[0].fromFieldId).toBe(textField.id);

      await deleteField(table1.id, formulaField.id);
      // reference should be deleted
      const referenceAfter = await prisma.reference.findFirst({
        where: { fromFieldId: textField.id },
      });
      expect(referenceAfter).toBeFalsy();

      // formula field should be deleted
      const fieldRaw = await prisma.field.findUnique({
        where: { id: formulaField.id },
      });
      expect(fieldRaw?.deletedTime).toBeTruthy();
    });

    it('should delete a middle formula field, a -> b -> c delete b', async () => {
      const textFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        options: SingleLineTextFieldCore.defaultOptions(),
      };
      const textField = await createField(table1.id, textFieldRo);
      const formula1FieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${textField.id}}`,
        },
      };
      const formula1Field = await createField(table1.id, formula1FieldRo);
      const formula2FieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${formula1Field.id}}`,
        },
      };
      await createField(table1.id, formula2FieldRo);

      const referenceBefore = await prisma.reference.findMany({
        where: { OR: [{ toFieldId: formula1Field.id }, { fromFieldId: formula1Field.id }] },
      });
      expect(referenceBefore.length).toBe(2);

      await deleteField(table1.id, formula1Field.id);

      // reference should be deleted
      const referenceAfter = await prisma.reference.findFirst({
        where: { OR: [{ toFieldId: formula1Field.id }, { fromFieldId: formula1Field.id }] },
      });
      expect(referenceAfter).toBeFalsy();

      // formula field should be deleted
      const fieldRaw = await prisma.field.findUnique({
        where: { id: formula1Field.id },
      });
      expect(fieldRaw?.deletedTime).toBeTruthy();
    });

    it('should delete a link field', async () => {
      const table2PrimaryField = table2.fields[0];
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          foreignTableId: table2.id,
          relationship: Relationship.ManyOne,
        } as ILinkFieldOptionsRo,
      };

      const linkField = await createField(table1.id, linkFieldRo);
      const symmetricFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId;

      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });

      const referenceBefore = await prisma.reference.findMany({
        where: { toFieldId: linkField.id },
      });
      expect(referenceBefore.length).toBe(1);
      expect(referenceBefore[0].fromFieldId).toBe(table2PrimaryField.id);

      // foreignKey should be created
      const { fkHostTableName, foreignKeyName } = linkField.options as ILinkFieldOptions;
      const linkedRecords = await prisma.$queryRawUnsafe<{ __id: string }[]>(
        knex(fkHostTableName).select('*').where(foreignKeyName, table2.records[0].id).toQuery()
      );
      expect(linkedRecords.length).toBe(1);

      await deleteField(table1.id, linkField.id);

      // reference should be deleted
      const referenceAfter = await prisma.reference.findFirst({
        where: { fromFieldId: table2PrimaryField.id },
      });
      expect(referenceAfter).toBeFalsy();
      const linkReferenceAfter = await prisma.reference.findFirst({
        where: { OR: [{ fromFieldId: linkField.id }, { toFieldId: linkField.id }] },
      });
      expect(linkReferenceAfter).toBeFalsy();
      const symLinkReferenceAfter = await prisma.reference.findFirst({
        where: { OR: [{ fromFieldId: symmetricFieldId }, { toFieldId: symmetricFieldId }] },
      });
      expect(symLinkReferenceAfter).toBeFalsy();

      // foreignKey should be removed
      expect(
        prisma.$queryRawUnsafe(
          knex(fkHostTableName).select('*').whereNotNull(foreignKeyName).toQuery()
        )
      ).rejects.toThrow();

      expect(
        prisma.$queryRawUnsafe<{ __id: string }[]>(
          knex(fkHostTableName).select('*').whereNotNull(linkField.dbFieldName).toQuery()
        )
      ).rejects.toThrow();

      // formula field should be marked as deleted
      const fieldRaw = await prisma.field.findUnique({
        where: { id: linkField.id },
      });
      expect(fieldRaw?.deletedTime).toBeTruthy();
      const symmetricalFieldRaw = await prisma.field.findUnique({
        where: { id: symmetricFieldId },
      });
      expect(symmetricalFieldRaw?.deletedTime).toBeTruthy();
    });

    it('should delete a link with lookup field and a referenced formula', async () => {
      const table1PrimaryField = table1.fields[0];
      const table2PrimaryField = table2.fields[0];
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          foreignTableId: table2.id,
          relationship: Relationship.ManyOne,
        } as ILinkFieldOptionsRo,
      };
      const linkField = await createField(table1.id, linkFieldRo);
      const symmetricFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId;

      const lookupFieldRo: IFieldRo = {
        type: table2PrimaryField.type,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2PrimaryField.id,
          linkFieldId: linkField.id,
        } as ILookupOptionsRo,
      };
      const lookupField = await createField(table1.id, lookupFieldRo);
      const symLookupFieldRo: IFieldRo = {
        type: table1PrimaryField.type,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table1.id,
          lookupFieldId: table1PrimaryField.id,
          linkFieldId: symmetricFieldId,
        } as ILookupOptionsRo,
      };
      const symLookupField = await createField(table2.id, symLookupFieldRo);

      const formulaFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${lookupField.id}} & {${table1.fields[0].id}}`,
        },
      };
      const formulaField = await createField(table1.id, formulaFieldRo);

      await updateRecordByApi(table2.id, table2.records[0].id, table2PrimaryField.id, 'text');
      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[0].id, 'formula');
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });

      const referenceBefore = await prisma.reference.findMany({
        where: { fromFieldId: table2PrimaryField.id },
      });
      expect(referenceBefore.length).toBe(2);

      // lookup cell and formula cell should be updated
      const record = await getRecord(table1.id, table1.records[0].id);
      expect(record.fields[lookupField.id]).toBe('text');
      expect(record.fields[formulaField.id]).toBe('textformula');

      await deleteField(table1.id, linkField.id);

      // link reference and all relational lookup reference should be deleted
      const referenceAfter = await prisma.reference.findMany({
        where: { fromFieldId: table2PrimaryField.id },
      });
      expect(referenceAfter.length).toBe(0);

      // lookup cell and formula cell should be keep
      const recordAfter = await getRecord(table1.id, table1.records[0].id);
      expect(recordAfter.fields[lookupField.id]).toBe('text');
      expect(recordAfter.fields[formulaField.id]).toBe('textformula');

      // lookup field should be marked as error
      const fieldRaw = await prisma.field.findUnique({
        where: { id: lookupField.id },
      });
      expect(fieldRaw?.hasError).toBeTruthy();

      const fieldRaw2 = await prisma.field.findUnique({
        where: { id: symLookupField.id },
      });
      expect(fieldRaw2?.hasError).toBeTruthy();
    });
  });
});
