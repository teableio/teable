/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ITableFullVo } from '@teable-group/core';
import {
  Relationship,
  TimeFormatting,
  DbFieldType,
  Colors,
  CellValueType,
  FieldType,
} from '@teable-group/core';
import type request from 'supertest';
import {
  createField,
  getField,
  getRecord,
  getRecords,
  initApp,
  updateField,
  updateRecordByApi,
} from './utils/init-app';

describe('OpenAPI Freely perform column transformations (e2e)', () => {
  let app: INestApplication;
  let table1: ITableFullVo;
  let table2: ITableFullVo;
  let request: request.SuperAgentTest;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    request = appCtx.request;

    const result1 = await request.post('/api/table').send({
      name: 'table1',
    });
    table1 = result1.body;
    const result2 = await request.post('/api/table').send({
      name: 'table2',
    });
    table2 = result2.body;
  });

  afterAll(async () => {
    await request.delete(`/api/table/arbitrary/${table1.id}`);
    await request.delete(`/api/table/arbitrary/${table2.id}`);

    await app.close();
  });

  async function expectUpdate(
    table: ITableFullVo,
    sourceFieldRo: IFieldRo,
    newFieldRo: IFieldRo,
    values: unknown[] = []
  ) {
    const sourceField = await createField(request, table.id, sourceFieldRo);
    for (const i in values) {
      const value = values[i];
      value != null &&
        (await updateRecordByApi(request, table.id, table.records[i].id, sourceField.id, value));
    }
    await updateField(request, table.id, sourceField.id, newFieldRo);
    const newField = await getField(request, table.id, sourceField.id);
    const records = await Promise.all(
      values.map((_, i) => getRecord(request, table.id, table.records[i].id))
    );

    const result = records.map((record) => record.fields[newField.id]);
    return {
      newField,
      values: result,
    };
  }

  describe('convert text field', () => {
    const sourceFieldRo: IFieldRo = {
      name: 'TextField',
      type: FieldType.SingleLineText,
    };

    it('should convert text to number', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.Number,
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        '1',
        'x',
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        name: 'TextField',
        type: FieldType.Number,
      });
      expect(values[0]).toEqual(1);
      expect(values[1]).toEqual(undefined);
    });

    it('should convert text to single select', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.SingleSelect,
        options: {
          choices: [{ name: 'x', color: Colors.Cyan }],
        },
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        'y',
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        options: {
          choices: [{ name: 'x', color: Colors.Cyan }, { name: 'y' }],
        },
        type: FieldType.SingleSelect,
      });
      expect(values[0]).toEqual('x');
      expect(values[1]).toEqual('y');
    });

    it('should convert text to multiple select', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.MultipleSelect,
        options: {
          choices: [
            { name: 'x', color: Colors.Blue },
            { name: 'y', color: Colors.Red },
          ],
        },
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        'x, y',
        'z',
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        dbFieldType: DbFieldType.Json,
        options: {
          choices: [
            { name: 'x', color: Colors.Blue },
            { name: 'y', color: Colors.Red },
            { name: 'z' },
          ],
        },
        type: FieldType.MultipleSelect,
      });
      expect(values[0]).toEqual(['x']);
      expect(values[1]).toEqual(['x', 'y']);
      expect(values[2]).toEqual(['z']);
    });

    it('should convert text to attachment', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.Attachment,
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        'y',
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Attachment,
      });
      expect(values[0]).toEqual(undefined);
      expect(values[1]).toEqual(undefined);
    });

    it('should convert text to checkbox', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.Checkbox,
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        null,
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.Boolean,
        dbFieldType: DbFieldType.Integer,
        type: FieldType.Checkbox,
      });
      expect(values[0]).toEqual(true);
      expect(values[1]).toEqual(undefined);
    });

    it('should convert text to date', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.Date,
        options: {
          formatting: {
            date: 'M/D/YYYY',
            time: TimeFormatting.None,
            timeZone: 'GMT',
          },
        },
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        '2023-08-31T08:32:32.117Z',
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.DateTime,
        dbFieldType: DbFieldType.DateTime,
        type: FieldType.Date,
      });
      expect(values[0]).toEqual(undefined);
      expect(values[1]).toEqual('2023-08-31T08:32:32.117Z');
    });

    it('should convert text to formula', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: '1',
        },
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        null,
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        type: FieldType.Formula,
        isComputed: true,
      });
      expect(values[0]).toEqual(1);
      expect(values[1]).toEqual(1);
    });

    it('should convert text to many-one lookup', async () => {
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };
      const linkField = await createField(request, table1.id, linkFieldRo);
      // set primary key 'x' in table2
      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      // add a link record
      await updateRecordByApi(request, table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });

      const newFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      };

      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [null]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
          linkFieldId: linkField.id,
        },
      });

      expect(values[0]).toEqual('x');
    });

    it('should convert text to one-many lookup', async () => {
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };
      const linkField = await createField(request, table1.id, linkFieldRo);
      // set primary key 'x'/'y' in table2
      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      await updateRecordByApi(request, table2.id, table2.records[1].id, table2.fields[0].id, 'y');
      // add a link record
      await updateRecordByApi(request, table1.id, table1.records[0].id, linkField.id, [
        {
          id: table2.records[0].id,
        },
        {
          id: table2.records[1].id,
        },
      ]);

      const newFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      };

      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [null]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        dbFieldType: DbFieldType.Json,
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          linkFieldId: linkField.id,
        },
      });

      expect(values[0]).toEqual(['x', 'y']);
    });

    it('should convert text to many-one rollup', async () => {
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };
      const linkField = await createField(request, table1.id, linkFieldRo);
      // set primary key 'x' in table2
      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      // add 2 link record
      await updateRecordByApi(request, table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });
      await updateRecordByApi(request, table1.id, table1.records[1].id, linkField.id, {
        id: table2.records[0].id,
      });

      const newFieldRo: IFieldRo = {
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      };

      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [null]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      });

      expect(values[0]).toEqual(1);
    });

    it('should convert text to one-many rollup', async () => {
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };
      const linkField = await createField(request, table1.id, linkFieldRo);
      // set primary key 'x' in table2
      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[0].id, 'gg');
      // add 2 link record
      await updateRecordByApi(request, table1.id, table1.records[0].id, linkField.id, [
        {
          id: table2.records[0].id,
        },
        {
          id: table2.records[1].id,
        },
      ]);

      const newFieldRo: IFieldRo = {
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      };

      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [null]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      });

      expect(values[0]).toEqual(2);
    });
  });

  describe('convert link field', () => {
    it('should convert text to many-one link', async () => {
      const sourceFieldRo: IFieldRo = {
        name: 'TextField',
        type: FieldType.SingleLineText,
      };
      const newFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      // set primary key 'x' in table2
      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[0].id, 'x');

      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x, y',
        'z',
      ]);

      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
        },
      });

      const { records } = await getRecords(request, table2.id);
      // only match 'x' in table2, because many-one link only allowed one value
      expect(values[0]).toEqual({ title: 'x', id: records[0].id });
      // create a new record in table2 to match 'z' that not exist in table 2 before
      expect(values[1]).toEqual({ title: 'z', id: records[3].id });
    });

    it('should convert text to one-many link', async () => {
      const sourceFieldRo: IFieldRo = {
        name: 'TextField',
        type: FieldType.SingleLineText,
      };
      const newFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      // set primary key 'x' in table2
      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      await updateRecordByApi(request, table2.id, table2.records[1].id, table2.fields[0].id, 'y');

      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x, y',
        'zz',
      ]);

      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
        },
      });

      const { records } = await getRecords(request, table2.id);
      expect(values[0]).toEqual([
        { title: 'x', id: records[0].id },
        { title: 'y', id: records[1].id },
      ]);
      // create a new record in table2 to match 'y' that not exist in table 2 before
      expect(values[1]).toEqual([{ title: 'zz', id: records[records.length - 1].id }]);
    });

    it('should convert many-one to one-many link', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      // set primary key 'x' in table2
      await updateRecordByApi(request, table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      await updateRecordByApi(request, table2.id, table2.records[1].id, table2.fields[0].id, 'y');

      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        { id: table2.records[0].id },
        { id: table2.records[0].id },
      ]);

      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
        },
      });

      const { records } = await getRecords(request, table2.id);
      // values[0] should replaced by values[1] to keep link consistency
      expect(values[0]).toEqual(undefined);
      expect(values[1]).toEqual([{ title: 'x', id: records[0].id }]);
    });
  });
});
