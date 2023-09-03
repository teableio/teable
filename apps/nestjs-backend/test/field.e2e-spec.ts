/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type {
  IFieldRo,
  IFieldVo,
  ITableFullVo,
  ILinkFieldOptionsRo,
  ILookupOptionsRo,
  ILinkFieldOptions,
} from '@teable-group/core';
import {
  Relationship,
  DateFormattingPreset,
  TimeFormatting,
  SingleLineTextFieldCore,
  FieldType,
} from '@teable-group/core';
import request from 'supertest';
import { PrismaService } from '../src/prisma.service';
import { createField, getRecord, initApp, updateRecordByApi } from './utils/init-app';

describe('OpenAPI FieldController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await initApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('CRUD', () => {
    let table1: ITableFullVo;

    beforeAll(async () => {
      const result = await request(app.getHttpServer())
        .post('/api/table')
        .send({
          name: 'table1',
        })
        .expect(201);
      table1 = result.body.data;
    });

    afterAll(async () => {
      await request(app.getHttpServer()).delete(`/api/table/arbitrary/${table1.id}`);
    });

    it('/api/table/{tableId}/field (GET)', async () => {
      const fieldsResult = await request(app.getHttpServer()).get(`/api/table/${table1.id}/field`);
      expect(fieldsResult.body.data).toHaveLength(3);
    });

    it('/api/table/{tableId}/field (POST)', async () => {
      const fieldRo: IFieldRo = {
        name: 'New field',
        description: 'the new field',
        type: FieldType.SingleLineText,
        options: SingleLineTextFieldCore.defaultOptions(),
      };

      await request(app.getHttpServer())
        .post(`/api/table/${table1.id}/field`)
        .send(fieldRo)
        .expect(201);

      const result = await request(app.getHttpServer())
        .get(`/api/table/${table1.id}/field`)
        .query({
          skip: 0,
          take: 1000,
        })
        .expect(200);

      const fields: IFieldVo[] = result.body.data;
      expect(fields).toHaveLength(4);
    });
  });

  describe('should generate default name and options for field', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;

    beforeAll(async () => {
      const result = await request(app.getHttpServer())
        .post('/api/table')
        .send({
          name: 'table1',
        })
        .expect(201);
      table1 = result.body.data;

      const result2 = await request(app.getHttpServer())
        .post('/api/table')
        .send({
          name: 'table2',
        })
        .expect(201);
      table2 = result2.body.data;
    });

    afterAll(async () => {
      await request(app.getHttpServer()).delete(`/api/table/arbitrary/${table1.id}`);
      await request(app.getHttpServer()).delete(`/api/table/arbitrary/${table2.id}`);
    });

    async function createFieldByType(
      type: FieldType,
      options?: IFieldRo['options']
    ): Promise<IFieldVo> {
      const fieldRo: IFieldRo = {
        type,
        options,
      };

      const result = await request(app.getHttpServer())
        .post(`/api/table/${table1.id}/field`)
        .send(fieldRo)
        .expect(201);
      return result.body.data;
    }
    it('basic field', async () => {
      const textField = await createFieldByType(FieldType.SingleLineText);
      expect(textField.name).toEqual('Label');
      expect(textField.options).toEqual({});

      const numberField = await createFieldByType(FieldType.Number);
      expect(numberField.name).toEqual('Number');
      expect(numberField.options).toEqual({ formatting: { precision: 2 } });

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
        formatting: { precision: 2 },
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
        const linkField = await createField(app, table1.id, {
          type: FieldType.Link,
          options: {
            foreignTableId: table2.id,
            relationship: Relationship.OneMany,
          } as ILinkFieldOptionsRo,
        });

        expect(linkField.name).toEqual(`${table2.name}`);
        const fieldsResult = await request(app.getHttpServer()).get(
          `/api/table/${table2.id}/field`
        );
        table2.fields = fieldsResult.body.data;
        const symmetricalLinkField = table2.fields.find((f) => f.type === FieldType.Link);

        expect(symmetricalLinkField?.name).toEqual(table1.name);
        const lookupField = await createField(app, table1.id, {
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

        const rollupField = await createField(app, table1.id, {
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
          formatting: { precision: 2 },
        });
      });
    });
  });

  describe('should safe delete field', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;

    beforeAll(async () => {
      const result = await request(app.getHttpServer())
        .post('/api/table')
        .send({
          name: 'table1',
        })
        .expect(201);
      table1 = result.body.data;

      const result2 = await request(app.getHttpServer())
        .post('/api/table')
        .send({
          name: 'table2',
        })
        .expect(201);
      table2 = result2.body.data;
    });

    afterAll(async () => {
      await request(app.getHttpServer()).delete(`/api/table/arbitrary/${table1.id}`);
      await request(app.getHttpServer()).delete(`/api/table/arbitrary/${table2.id}`);
    });

    async function createField(tableId: string, fieldRo: IFieldRo): Promise<IFieldVo> {
      const result = await request(app.getHttpServer())
        .post(`/api/table/${tableId}/field`)
        .send(fieldRo)
        .expect(201);
      return result.body.data;
    }

    async function deleteField(tableId: string, fieldId: string): Promise<IFieldVo> {
      const result = await request(app.getHttpServer())
        .delete(`/api/table/${tableId}/field/${fieldId}`)
        .expect(200);
      return result.body.data;
    }
    let prisma: PrismaService;

    beforeAll(async () => {
      prisma = app.get(PrismaService);
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

      await updateRecordByApi(app, table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });

      const referenceBefore = await prisma.reference.findMany({
        where: { toFieldId: linkField.id },
      });
      expect(referenceBefore.length).toBe(1);
      expect(referenceBefore[0].fromFieldId).toBe(table2PrimaryField.id);

      // foreignKey should be created
      const dbTableName = table1.dbTableName;
      const { dbForeignKeyName } = linkField.options as ILinkFieldOptions;
      const linkedRecords = await prisma.$queryRawUnsafe<{ __id: string }[]>(
        `SELECT * FROM "${dbTableName}" WHERE "${dbForeignKeyName}" = "${table2.records[0].id}"`
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
      const linkedRecordsAfter = await prisma.$queryRawUnsafe<{ __id: string }[]>(
        `SELECT * FROM "${dbTableName}" WHERE "${dbForeignKeyName}" NOTNULL`
      );
      expect(linkedRecordsAfter.length).toBe(0);

      // cell should be clean
      const linkedCellAfter = await prisma.$queryRawUnsafe<{ __id: string }[]>(
        `SELECT * FROM "${dbTableName}" WHERE "${linkField.dbFieldName}" NOTNULL`
      );
      expect(linkedCellAfter.length).toBe(0);

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

      await updateRecordByApi(app, table2.id, table2.records[0].id, table2PrimaryField.id, 'text');
      await updateRecordByApi(app, table1.id, table1.records[0].id, table1.fields[0].id, 'formula');
      await updateRecordByApi(app, table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });

      const referenceBefore = await prisma.reference.findMany({
        where: { fromFieldId: table2PrimaryField.id },
      });
      expect(referenceBefore.length).toBe(2);

      // lookup cell and formula cell should be updated
      const record = await getRecord(app, table1.id, table1.records[0].id);
      expect(record.fields[lookupField.id]).toBe('text');
      expect(record.fields[formulaField.id]).toBe('textformula');

      await deleteField(table1.id, linkField.id);

      // link reference and all relational lookup reference should be deleted
      const referenceAfter = await prisma.reference.findMany({
        where: { fromFieldId: table2PrimaryField.id },
      });
      expect(referenceAfter.length).toBe(0);

      // lookup cell and formula cell should be clean
      const recordAfter = await getRecord(app, table1.id, table1.records[0].id);
      expect(recordAfter.fields[lookupField.id]).toBe(undefined);
      expect(recordAfter.fields[formulaField.id]).toBe('formula');

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
