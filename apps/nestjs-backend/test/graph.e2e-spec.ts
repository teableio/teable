/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldType, Relationship, type IFieldRo, type ITableFullVo } from '@teable-group/core';
import { planFieldCreate, planFieldUpdate } from '@teable-group/openapi';
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

  it('should create formula field plan', async () => {
    const formulaRo: IFieldRo = {
      name: 'formula',
      type: FieldType.Formula,
      options: {
        expression: `{${table1.fields[0].id}}`,
      },
    };

    const { data: plan } = await planFieldCreate(table1.id, formulaRo);

    expect(plan).toMatchObject({
      isAsync: false,
      updateCellCount: 3,
      totalCellCount: 6,
    });
    expect(plan.graph?.nodes).toHaveLength(2);
    expect(plan.graph?.edges).toHaveLength(1);
    expect(plan.graph?.combos).toHaveLength(1);
  });

  it('should create lookup field plan', async () => {
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

    const { data: plan } = await planFieldCreate(table1.id, lookupFieldRo);

    expect(plan).toMatchObject({
      isAsync: false,
      updateCellCount: table1.records.length,
      totalCellCount: table1.records.length * 2 + table2.records.length,
    });
    expect(plan.graph?.nodes).toHaveLength(3);
    expect(plan.graph?.edges).toHaveLength(2);
    expect(plan.graph?.combos).toHaveLength(2);
  });

  it('should update formula field plan', async () => {
    const textField = table1.fields[0];
    const formulaRo: IFieldRo = {
      name: 'formula',
      type: FieldType.Formula,
      options: {
        expression: `{${textField.id}}`,
      },
    };

    const newFieldRo: IFieldRo = {
      name: 'formula',
      type: FieldType.Number,
    };

    await createField(table1.id, formulaRo);

    const { data: plan } = await planFieldUpdate(table1.id, textField.id, newFieldRo);

    expect(plan.skip).toBeUndefined();
    if (plan.skip) {
      return;
    }
    expect(plan).toMatchObject({
      isAsync: false,
      updateCellCount: 6,
      totalCellCount: 6,
    });
    expect(plan.graph?.nodes).toHaveLength(2);
    expect(plan.graph?.edges).toHaveLength(1);
    expect(plan.graph?.combos).toHaveLength(1);
  });

  it('should update normal field plan', async () => {
    const textField = table1.fields[0];
    const formulaRo: IFieldRo = {
      name: 'formula',
      type: FieldType.Formula,
      options: {
        expression: `{${textField.id}}`,
      },
    };

    const newFieldRo: IFieldRo = {
      name: 'new Name',
      type: textField.type,
    };

    await createField(table1.id, formulaRo);

    const { data: plan } = await planFieldUpdate(table1.id, textField.id, newFieldRo);

    expect(plan.skip).toBeTruthy();
  });

  it('should update lookup field plan', async () => {
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

    const lookupField = await createField(table1.id, lookupFieldRo);

    const formulaRo: IFieldRo = {
      name: 'formula',
      type: FieldType.Formula,
      options: {
        expression: `{${lookupField.id}}`,
      },
    };
    await createField(table1.id, formulaRo);

    const lookupFieldRo2: IFieldRo = {
      isLookup: true,
      type: FieldType.Number,
      lookupOptions: {
        foreignTableId: table2.id,
        linkFieldId: linkField.id,
        lookupFieldId: table2.fields[1].id,
      },
    };

    const { data: plan } = await planFieldUpdate(table1.id, lookupField.id, lookupFieldRo2);

    expect(plan.skip).toBeUndefined();
    if (plan.skip) {
      return;
    }

    expect(plan).toMatchObject({
      isAsync: false,
      updateCellCount: table1.records.length * 2,
      totalCellCount: table1.records.length * 3,
    });
    expect(plan.graph?.nodes).toHaveLength(3);
    expect(plan.graph?.edges).toHaveLength(2);
    expect(plan.graph?.combos).toHaveLength(2);
  });
});
