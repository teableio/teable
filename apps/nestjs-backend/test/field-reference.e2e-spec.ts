import type { INestApplication } from '@nestjs/common';
import type { IFieldRo } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import type { LinkFieldDto } from '../src/features/field/model/field-dto/link-field.dto';
import {
  createField,
  createTable,
  permanentDeleteTable,
  getField,
  initApp,
} from './utils/init-app';

describe('OpenAPI link field reference (e2e)', () => {
  let app: INestApplication;
  let table1Id = '';
  let table2Id = '';
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    table1Id = (await createTable(baseId, { name: 'table1' })).id;
    table2Id = (await createTable(baseId, { name: 'table2' })).id;
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, table1Id);
    await permanentDeleteTable(baseId, table2Id);

    await app.close();
  });

  it('/api/table/{tableId}/field (POST) create ManyOne', async () => {
    const fieldRo: IFieldRo = {
      name: 'New field',
      description: 'the new field',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyOne,
        foreignTableId: table2Id,
      },
    };

    const field1 = (await createField(table1Id, fieldRo)) as LinkFieldDto;
    const field2 = (await getField(table2Id, field1.options.symmetricFieldId!)) as LinkFieldDto;

    expect(field1.options.foreignTableId).toBe(table2Id);
    expect(field1.options.symmetricFieldId).toBe(field2.id);
    expect(field2.options.relationship).toBe(Relationship.OneMany);
    expect(field2.options.foreignTableId).toBe(table1Id);
    expect(field2.options.symmetricFieldId).toBe(field1.id);
    expect(field1.options.foreignKeyName).toBe(`__fk_${field1.id}`);
    expect(field2.options.selfKeyName).toBe(`__fk_${field1.id}`);
  });

  it('/api/table/{tableId}/field (POST) create OneMany', async () => {
    const fieldRo: IFieldRo = {
      name: 'New field',
      description: 'the new field',
      type: FieldType.Link,
      options: {
        relationship: Relationship.OneMany,
        foreignTableId: table2Id,
      },
    };

    const field1 = (await createField(table1Id, fieldRo)) as LinkFieldDto;
    const field2 = (await getField(table2Id, field1.options.symmetricFieldId!)) as LinkFieldDto;

    expect(field1.options.foreignTableId).toBe(table2Id);
    expect(field1.options.symmetricFieldId).toBe(field2.id);
    expect(field2.options.relationship).toBe(Relationship.ManyOne);
    expect(field2.options.foreignTableId).toBe(table1Id);
    expect(field2.options.symmetricFieldId).toBe(field1.id);
    expect(field1.options.selfKeyName).toBe(`__fk_${field2.id}`);
    expect(field2.options.foreignKeyName).toBe(`__fk_${field2.id}`);
  });
});
