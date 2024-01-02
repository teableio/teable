/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldType, Relationship, type IFieldRo, type ITableFullVo } from '@teable-group/core';
import { planFieldCreate } from '@teable-group/openapi';
import { createField, createTable, deleteTable, initApp } from './utils/init-app';

describe('OpenAPI Graph (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let table1: ITableFullVo;
  let table2: ITableFullVo;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    table1 = await createTable(baseId, {
      name: 'table1',
    });
    table2 = await createTable(baseId, {
      name: 'table2',
      records: [{ fields: {} }],
    });
  });

  afterEach(async () => {
    await deleteTable(baseId, table1.id);
    await deleteTable(baseId, table2.id);
  });

  it('should create formula field plain', async () => {
    const formulaRo: IFieldRo = {
      name: 'formula',
      type: FieldType.Formula,
      options: {
        expression: `{${table1.fields[0].id}}`,
      },
    };

    const { data: plain } = await planFieldCreate(table1.id, formulaRo);

    expect(plain).toMatchObject({
      isAsync: false,
      updateCellCount: 3,
      totalCellCount: 6,
    });
    expect(plain.graph?.nodes).toHaveLength(2);
    expect(plain.graph?.edges).toHaveLength(1);
    expect(plain.graph?.combos).toHaveLength(1);
  });

  it('should create lookup field plain', async () => {
    const linkFieldRo: IFieldRo = {
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: table2.id,
      },
    };

    const linkField = await createField(table1.id, linkFieldRo);

    const lookupFieldRo: IFieldRo = {
      isLookup: true,
      type: FieldType.SingleLineText,
      lookupOptions: {
        foreignTableId: table2.id,
        linkFieldId: linkField.id,
        lookupFieldId: table2.fields[0].id,
      },
    };

    const { data: plain } = await planFieldCreate(table1.id, lookupFieldRo);

    expect(plain).toMatchObject({
      isAsync: false,
      updateCellCount: table1.records.length,
      totalCellCount: table1.records.length * 2 + table2.records.length,
    });
    expect(plain.graph?.nodes).toHaveLength(3);
    expect(plain.graph?.edges).toHaveLength(2);
    expect(plain.graph?.combos).toHaveLength(2);
  });
});
