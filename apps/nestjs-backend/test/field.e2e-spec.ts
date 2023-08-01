import type { INestApplication } from '@nestjs/common';
import type {
  IFieldRo,
  IFieldVo,
  ITableFullVo,
  ILinkFieldOptionsRo,
  ILookupOptionsRo,
} from '@teable-group/core';
import {
  Relationship,
  DateFormattingPreset,
  TimeFormatting,
  SingleLineTextFieldCore,
  FieldType,
} from '@teable-group/core';
import request from 'supertest';
import { initApp } from './utils/init-app';

describe('OpenAPI FieldController (e2e)', () => {
  let app: INestApplication;
  let table1: ITableFullVo;

  beforeAll(async () => {
    app = await initApp();

    const result = await request(app.getHttpServer()).post('/api/table').send({
      name: 'table1',
    });
    table1 = result.body.data;
  });

  afterAll(async () => {
    await request(app.getHttpServer()).delete(`/api/table/arbitrary/${table1.id}`).expect(200);

    await app.close();
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

  describe('should generate default name and options for field', () => {
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

    async function createField(fieldRo: IFieldRo): Promise<IFieldVo> {
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
      let table2: ITableFullVo;
      beforeAll(async () => {
        const result = await request(app.getHttpServer()).post('/api/table').send({
          name: 'table2',
        });
        table2 = result.body.data;
      });

      afterAll(async () => {
        await request(app.getHttpServer()).delete(`/api/table/arbitrary/${table2.id}`).expect(200);
      });

      it('should generate semantic field name for link and lookup and rollup field ', async () => {
        const linkField = await createField({
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

        const lookupField = await createField({
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

        const rollupField = await createField({
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
});
