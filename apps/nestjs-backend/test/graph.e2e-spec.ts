/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import {
  FieldType,
  Relationship,
  type IFieldRo,
  type IButtonFieldOptions,
  type ILinkFieldOptions,
  FieldAIActionType,
  FieldKeyType,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import { planField, planFieldCreate, planFieldConvert, updateRecord } from '@teable/openapi';
import {
  createField,
  createTable,
  deleteTable,
  permanentDeleteTable,
  initApp,
} from './utils/init-app';

describe('OpenAPI Graph (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const baseId = globalThis.testConfig.baseId;
  let table1: ITableFullVo;
  let table2: ITableFullVo;
  // These specs assert v1 graph plans; FORCE_V2_ALL routes requests to v2,
  // where the v1 plan counters stay zero. Pin it off and let the v2-only
  // specs re-enable it locally (see withForceV2All below).
  let previousForceV2All: string | undefined;

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'false';
    const appCtx = await initApp();
    app = appCtx.app;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (previousForceV2All == null) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
    await app.close();
  });

  beforeEach(async () => {
    table1 = await createTable(baseId, {
      name: 'table1',
    });
    table2 = await createTable(baseId, {
      name: 'table2',
      records: Array.from({ length: 10 }).map(() => ({ fields: {} })),
    });
  });

  afterEach(async () => {
    await permanentDeleteTable(baseId, table1.id);
    await permanentDeleteTable(baseId, table2.id);
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

    expect(plan.updateCellCount).toEqual(3);
    expect(plan.graph?.nodes).toHaveLength(2);
    expect(plan.graph?.edges).toHaveLength(1);
    expect(plan.graph?.combos).toHaveLength(1);
  });

  it('should return a create field plan in v2 canary mode', async () => {
    const previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';

    try {
      const formulaRo: IFieldRo = {
        name: 'formula',
        type: FieldType.Formula,
        options: {
          expression: `{${table1.fields[0].id}}`,
        },
      };

      const { data: plan } = await planFieldCreate(table1.id, formulaRo);

      expect(plan).toEqual({
        estimateTime: 0,
        updateCellCount: 0,
      });
    } finally {
      if (previousForceV2All == null) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previousForceV2All;
      }
    }
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
      updateCellCount: table1.records.length,
    });
    expect(plan.graph?.nodes).toHaveLength(3);
    expect(plan.graph?.edges).toHaveLength(2);
    expect(plan.graph?.combos).toHaveLength(2);
  });

  it('should plan an empty simple field with no reference', async () => {
    const numberField = table1.fields[1];

    const { data: plan } = await planField(table1.id, numberField.id);

    expect(plan).toMatchObject({
      updateCellCount: 3,
    });

    expect(plan.graph?.nodes).toHaveLength(1);
    expect(plan.graph?.edges).toHaveLength(0);
    expect(plan.graph?.combos).toHaveLength(1);
  });

  it('should plan simple field with ManyOne link', async () => {
    const textField = table1.fields[0];
    const linkFieldRo = {
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyOne,
        foreignTableId: table1.id,
      },
    };
    const linkField = await createField(table2.id, linkFieldRo);

    await updateRecord(table2.id, table2.records[0].id, {
      record: {
        fields: {
          [linkField.id]: { id: table1.records[0].id },
        },
      },
      fieldKeyType: FieldKeyType.Id,
    });

    const { data: plan } = await planField(table1.id, textField.id);

    expect(plan.updateCellCount).toEqual(4);

    expect(plan.graph?.nodes).toHaveLength(2);
    expect(plan.graph?.edges).toHaveLength(1);
    expect(plan.graph?.combos).toHaveLength(2);
  });

  it('should plan simple field with OneMany link', async () => {
    const textField = table1.fields[0];
    const linkFieldRo = {
      type: FieldType.Link,
      options: {
        relationship: Relationship.OneMany,
        foreignTableId: table1.id,
      },
    };
    const linkField = await createField(table2.id, linkFieldRo);

    await updateRecord(table2.id, table2.records[0].id, {
      record: {
        fields: {
          [linkField.id]: [{ id: table1.records[0].id }, { id: table1.records[1].id }],
        },
      },
      fieldKeyType: FieldKeyType.Id,
    });

    const { data: plan } = await planField(table1.id, textField.id);

    expect(plan.updateCellCount).toEqual(4);

    expect(plan.graph?.nodes).toHaveLength(2);
    expect(plan.graph?.edges).toHaveLength(1);
    expect(plan.graph?.combos).toHaveLength(2);
  });

  it('should plan text to number field reference by formula', async () => {
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

    const { data: plan } = await planFieldConvert(table1.id, textField.id, newFieldRo);

    expect(plan.skip).toBeUndefined();
    expect(plan.updateCellCount).toEqual(6);
    expect(plan.graph?.nodes).toHaveLength(2);
    expect(plan.graph?.edges).toHaveLength(1);
    expect(plan.graph?.combos).toHaveLength(1);
  });

  it('should plan text to formula field', async () => {
    const numberField = table1.fields[1];
    const textFieldRo: IFieldRo = {
      type: FieldType.SingleSelect,
    };

    const textField = await createField(table1.id, textFieldRo);

    const formulaRo: IFieldRo = {
      name: 'formula',
      type: FieldType.Formula,
      options: {
        expression: `{${numberField.id}}`,
      },
    };

    const { data: plan } = await planFieldConvert(table1.id, textField.id, formulaRo);

    expect(plan.skip).toBeUndefined();
    expect(plan).toMatchObject({
      updateCellCount: 3,
    });
    expect(plan.graph?.nodes).toHaveLength(2);
    expect(plan.graph?.edges).toHaveLength(1);
    expect(plan.graph?.combos).toHaveLength(1);
  });

  it('should plan formula update with more reference field', async () => {
    const textField = table1.fields[0];
    const numberField = table1.fields[1];
    const formulaRo: IFieldRo = {
      name: 'formula',
      type: FieldType.Formula,
      options: {
        expression: `{${textField.id}}`,
      },
    };

    const newFormulaFieldRo: IFieldRo = {
      type: FieldType.Formula,
      options: {
        expression: `{${textField.id}} & {${numberField.id}}`,
      },
    };

    const formulaField = await createField(table1.id, formulaRo);

    const { data: plan } = await planFieldConvert(table1.id, formulaField.id, newFormulaFieldRo);

    expect(plan.skip).toBeUndefined();
    expect(plan).toMatchObject({
      updateCellCount: 3,
    });
    expect(plan.graph?.nodes).toHaveLength(3);
    expect(plan.graph?.edges).toHaveLength(2);
    expect(plan.graph?.combos).toHaveLength(1);
  });

  it('should plan formula with more reference field', async () => {
    const textField = table1.fields[0];
    const numberField = table1.fields[1];

    const formulaRo: IFieldRo = {
      type: FieldType.Formula,
      options: {
        expression: `{${textField.id}} & {${numberField.id}}`,
      },
    };

    const formulaField = await createField(table1.id, formulaRo);

    const { data: plan } = await planField(table1.id, formulaField.id);

    expect(plan).toMatchObject({
      updateCellCount: 9,
    });
    expect(plan.graph?.nodes).toHaveLength(3);
    expect(plan.graph?.edges).toHaveLength(2);
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

    const { data: plan } = await planFieldConvert(table1.id, textField.id, newFieldRo);

    expect(plan.skip).toBeTruthy();
  });

  it('should skip the update plan when only button display options change', async () => {
    const buttonField = await createField(table1.id, {
      name: 'Action',
      type: FieldType.Button,
      options: {
        label: 'Run',
        color: 'teal',
        maxCount: 1,
        resetCount: true,
        confirm: {
          title: 'Confirm action',
          description: 'Run this action?',
          confirmText: 'Run',
        },
      } satisfies IButtonFieldOptions,
    });

    const { data: plan } = await planFieldConvert(table1.id, buttonField.id, {
      type: FieldType.Button,
      options: {
        ...(buttonField.options as IButtonFieldOptions),
        label: 'Deploy',
        color: 'red',
        maxCount: 2,
        resetCount: false,
        confirm: {
          title: 'Confirm deployment',
          description: 'Deploy this release?',
          confirmText: 'Deploy',
        },
      } satisfies IButtonFieldOptions,
    });

    expect(plan).toEqual({ skip: true });
  });

  it('should skip the update plan when only the AI config of a longText field changes', async () => {
    const textField = table1.fields[0];
    await updateRecord(table1.id, table1.records[0].id, {
      fieldKeyType: FieldKeyType.Id,
      record: {
        fields: {
          [textField.id]: 'hello',
        },
      },
    });

    const aiField = await createField(table1.id, {
      name: 'AI Reply',
      type: FieldType.LongText,
      options: {
        showAs: { type: 'markdown' },
      },
      aiConfig: {
        type: FieldAIActionType.Customization,
        modelKey: 'old-model',
        prompt: 'Write a concise reply.',
      },
    });

    // Fields created before the options-union regression store clean options
    // ({showAs} only); restore that stored shape to model an existing field.
    await prisma.field.update({
      where: { id: aiField.id },
      data: { options: JSON.stringify({ showAs: { type: 'markdown' } }) },
    });

    // The field editor always resubmits the unchanged options together with the
    // new aiConfig; the plan must still recognize this as a non-data change.
    const { data: plan } = await planFieldConvert(table1.id, aiField.id, {
      type: FieldType.LongText,
      options: {
        showAs: { type: 'markdown' },
      },
      aiConfig: {
        type: FieldAIActionType.Customization,
        modelKey: 'new-model',
        prompt: 'Write a concise reply.',
      },
    });

    expect(plan).toEqual({ skip: true });
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

    const { data: plan } = await planFieldConvert(table1.id, lookupField.id, lookupFieldRo2);

    expect(plan.skip).toBeUndefined();

    expect(plan).toMatchObject({
      updateCellCount: 6,
    });
    expect(plan.graph?.nodes).toHaveLength(3);
    expect(plan.graph?.edges).toHaveLength(2);
    expect(plan.graph?.combos).toHaveLength(2);
  });

  it('should ignore stale references to deleted fields when planning single select conversion', async () => {
    const hostField = await createField(table1.id, {
      name: 'stale source',
      type: FieldType.SingleLineText,
    });
    const tempTable = await createTable(baseId, {
      name: 'stale-temp-table',
    });
    const deletedFieldId = tempTable.fields[0].id;
    const staleReferenceId = `ref-stale-${Date.now()}`;

    try {
      await deleteTable(baseId, tempTable.id);

      const deletedField = await prisma.txClient().field.findUnique({
        where: { id: deletedFieldId },
        select: { id: true, deletedTime: true },
      });
      expect(deletedField?.deletedTime).toBeTruthy();

      await prisma.txClient().reference.create({
        data: {
          id: staleReferenceId,
          fromFieldId: hostField.id,
          toFieldId: deletedFieldId,
        },
      });

      const { data: plan } = await planFieldConvert(table1.id, hostField.id, {
        type: FieldType.SingleSelect,
      });

      expect(plan.skip).toBeUndefined();
      expect(plan.updateCellCount).toEqual(table1.records.length);
      expect(plan.graph?.nodes).toHaveLength(1);
      expect(plan.graph?.edges).toHaveLength(0);
      expect(plan.graph?.combos).toHaveLength(1);
    } finally {
      await prisma.txClient().reference.deleteMany({
        where: { id: staleReferenceId },
      });
      await permanentDeleteTable(baseId, tempTable.id);
    }
  });

  it('should ignore broken link key metadata when planning single select conversion', async () => {
    const hostField = table1.fields[0];
    const linkField = await createField(table2.id, {
      name: 'broken key link',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: table1.id,
      },
    });
    const originalOptions = linkField.options as ILinkFieldOptions;

    try {
      const { selfKeyName: _selfKeyName, ...brokenOptions } = originalOptions;
      await prisma.txClient().field.update({
        where: { id: linkField.id },
        data: {
          options: JSON.stringify(brokenOptions),
        },
      });

      const { data: plan } = await planFieldConvert(table1.id, hostField.id, {
        type: FieldType.SingleSelect,
      });

      expect(plan.skip).toBeUndefined();
      expect(plan.updateCellCount).toEqual(table1.records.length);
      expect(plan.graph?.nodes).toHaveLength(2);
      expect(plan.graph?.edges).toHaveLength(1);
      expect(plan.graph?.combos).toHaveLength(2);
    } finally {
      await prisma.txClient().field.update({
        where: { id: linkField.id },
        data: {
          options: JSON.stringify(originalOptions),
        },
      });
    }
  });

  it('should ignore missing junction storage when planning single select conversion', async () => {
    const hostField = table1.fields[0];
    const linkField = await createField(table2.id, {
      name: 'broken storage link',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: table1.id,
      },
    });
    const originalOptions = linkField.options as ILinkFieldOptions;

    try {
      await prisma.txClient().field.update({
        where: { id: linkField.id },
        data: {
          options: JSON.stringify({
            ...originalOptions,
            fkHostTableName: `${originalOptions.fkHostTableName}_missing`,
          }),
        },
      });

      const { data: plan } = await planFieldConvert(table1.id, hostField.id, {
        type: FieldType.SingleSelect,
      });

      expect(plan.skip).toBeUndefined();
      expect(plan.updateCellCount).toEqual(table1.records.length);
      expect(plan.graph?.nodes).toHaveLength(2);
      expect(plan.graph?.edges).toHaveLength(1);
      expect(plan.graph?.combos).toHaveLength(2);
    } finally {
      await prisma.txClient().field.update({
        where: { id: linkField.id },
        data: {
          options: JSON.stringify(originalOptions),
        },
      });
    }
  });

  // The v2 convert dry run only serves v2-routed requests; the other specs in
  // this file pin FORCE_V2_ALL off, so the v2 dry-run specs opt back in
  // explicitly. See field-open-api.controller.ts planFieldConvert.
  const withForceV2All = async (fn: () => Promise<void>) => {
    const previous = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';
    try {
      await fn();
    } finally {
      if (previous == null) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previous;
      }
    }
  };

  it('should skip the v2 convert dry run when only AI config or display options change', async () => {
    await withForceV2All(async () => {
      const aiField = await createField(table1.id, {
        name: 'AI Reply',
        type: FieldType.LongText,
        options: {
          showAs: { type: 'markdown' },
        },
        aiConfig: {
          type: FieldAIActionType.Customization,
          modelKey: 'old-model',
          prompt: 'Write a concise reply.',
        },
      });

      const { data: plan } = await planFieldConvert(table1.id, aiField.id, {
        type: FieldType.LongText,
        options: {
          showAs: { type: 'markdown' },
        },
        aiConfig: {
          type: FieldAIActionType.Customization,
          modelKey: 'new-model',
          prompt: 'Write a concise reply.',
        },
      });

      expect(plan).toEqual({ skip: true });
    });
  });

  it('should count affected cells in the v2 convert dry run for a type conversion', async () => {
    await withForceV2All(async () => {
      const textField = table1.fields[0];
      await updateRecord(table1.id, table1.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [textField.id]: 'hello',
          },
        },
      });

      const longTextField = await createField(table1.id, {
        name: 'Notes',
        type: FieldType.LongText,
      });
      await updateRecord(table1.id, table1.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [longTextField.id]: 'some notes',
          },
        },
      });

      const { data: plan } = await planFieldConvert(table1.id, longTextField.id, {
        type: FieldType.SingleLineText,
      });

      expect(plan.skip).toBeUndefined();
      expect(plan.updateCellCount).toEqual(1);
      expect(plan.linkFieldCount).toEqual(0);
    });
  });
});
