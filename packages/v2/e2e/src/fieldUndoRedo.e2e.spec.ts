import {
  ActorId,
  CreateFieldCommand,
  CreateRecordCommand,
  DeleteFieldCommand,
  DuplicateFieldCommand,
  FieldId,
  type DuplicateFieldResult,
  type ICommandBus,
  RedoCommand,
  UndoCommand,
  UpdateFieldCommand,
  v2CoreTokens,
} from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  getSharedTestContext,
  TEST_USER,
  type SharedTestContext,
} from './shared/globalTestContext';

const buildContext = (windowId: string) => ({
  actorId: ActorId.create(TEST_USER.id)._unsafeUnwrap(),
  windowId,
});

const findFieldId = (table: { fields: Array<{ id: string; name: string }> }, name: string) => {
  const fieldId = table.fields.find((field) => field.name === name)?.id;
  if (!fieldId) {
    throw new Error(`Missing field: ${name}`);
  }
  return fieldId;
};

describe('v2 field undo/redo (e2e)', () => {
  let ctx: SharedTestContext;
  let commandBus: ICommandBus;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    commandBus = ctx.testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
  });

  it('undoes and redoes field creation', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo Redo Create Field',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const tableId = table.id;
    const fieldId = `fld${'c'.repeat(16)}`;
    const windowId = 'e2e-field-create';
    const context = buildContext(windowId);

    const createCommand = CreateFieldCommand.create({
      baseId: ctx.baseId,
      tableId,
      field: {
        id: fieldId,
        type: 'singleLineText',
        name: 'Notes',
      },
    })._unsafeUnwrap();
    const undoCommand = UndoCommand.create({ tableId, windowId })._unsafeUnwrap();
    const redoCommand = RedoCommand.create({ tableId, windowId })._unsafeUnwrap();

    (await commandBus.execute(context, createCommand))._unsafeUnwrap();
    expect((await ctx.getTableById(tableId)).fields.some((field) => field.id === fieldId)).toBe(
      true
    );

    (await commandBus.execute(context, undoCommand))._unsafeUnwrap();
    expect((await ctx.getTableById(tableId)).fields.some((field) => field.id === fieldId)).toBe(
      false
    );

    (await commandBus.execute(context, redoCommand))._unsafeUnwrap();
    expect((await ctx.getTableById(tableId)).fields.some((field) => field.id === fieldId)).toBe(
      true
    );
  });

  it('undoes and redoes field deletion with record values', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo Redo Delete Field',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
      views: [{ type: 'grid' }],
    });
    const tableId = table.id;
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');
    const record = await ctx.createRecord(tableId, {
      [titleFieldId]: 'A',
      [amountFieldId]: 42,
    });
    const windowId = 'e2e-field-delete';
    const context = buildContext(windowId);

    const deleteCommand = DeleteFieldCommand.create({
      baseId: ctx.baseId,
      tableId,
      fieldId: amountFieldId,
    })._unsafeUnwrap();
    const undoCommand = UndoCommand.create({ tableId, windowId })._unsafeUnwrap();
    const redoCommand = RedoCommand.create({ tableId, windowId })._unsafeUnwrap();

    (await commandBus.execute(context, deleteCommand))._unsafeUnwrap();
    expect(
      (await ctx.getTableById(tableId)).fields.some((field) => field.id === amountFieldId)
    ).toBe(false);

    (await commandBus.execute(context, undoCommand))._unsafeUnwrap();
    const undoneTable = await ctx.getTableById(tableId);
    expect(undoneTable.fields.some((field) => field.id === amountFieldId)).toBe(true);
    const undoneRecord = (await ctx.listRecords(tableId)).find((item) => item.id === record.id);
    expect(undoneRecord?.fields[amountFieldId]).toBe(42);

    (await commandBus.execute(context, redoCommand))._unsafeUnwrap();
    expect(
      (await ctx.getTableById(tableId)).fields.some((field) => field.id === amountFieldId)
    ).toBe(false);
  });

  it('undoes constrained field deletion and restores notNull / unique enforcement', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo Redo Delete Constrained Field',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const tableId = table.id;
    const titleFieldId = findFieldId(table, 'Title');
    const codeFieldId = `fld${'d'.repeat(16)}`;
    const windowId = 'e2e-field-delete-constrained';
    const context = buildContext(windowId);

    const createCodeFieldCommand = CreateFieldCommand.create({
      baseId: ctx.baseId,
      tableId,
      field: {
        id: codeFieldId,
        type: 'singleLineText',
        name: 'Code',
        notNull: true,
        unique: true,
      },
    })._unsafeUnwrap();
    const deleteCommand = DeleteFieldCommand.create({
      baseId: ctx.baseId,
      tableId,
      fieldId: codeFieldId,
    })._unsafeUnwrap();
    const undoCommand = UndoCommand.create({ tableId, windowId })._unsafeUnwrap();
    const redoCommand = RedoCommand.create({ tableId, windowId })._unsafeUnwrap();

    (await commandBus.execute(context, createCodeFieldCommand))._unsafeUnwrap();

    const firstRecord = await ctx.createRecord(tableId, {
      [titleFieldId]: 'Alpha',
      [codeFieldId]: 'CODE-001',
    });
    const secondRecord = await ctx.createRecord(tableId, {
      [titleFieldId]: 'Beta',
      [codeFieldId]: 'CODE-002',
    });

    (await commandBus.execute(context, deleteCommand))._unsafeUnwrap();
    expect((await ctx.getTableById(tableId)).fields.some((field) => field.id === codeFieldId)).toBe(
      false
    );

    (await commandBus.execute(context, undoCommand))._unsafeUnwrap();
    const undoneTable = await ctx.getTableById(tableId);
    const restoredCodeField = undoneTable.fields.find((field) => field.id === codeFieldId);
    expect(restoredCodeField?.notNull).toBe(true);
    expect(restoredCodeField?.unique).toBe(true);

    const recordsAfterUndo = await ctx.listRecords(tableId);
    expect(recordsAfterUndo.find((item) => item.id === firstRecord.id)?.fields[codeFieldId]).toBe(
      'CODE-001'
    );
    expect(recordsAfterUndo.find((item) => item.id === secondRecord.id)?.fields[codeFieldId]).toBe(
      'CODE-002'
    );

    const validationContext = buildContext('e2e-field-delete-constrained-validation');
    const missingRequiredResult = await commandBus.execute(
      validationContext,
      CreateRecordCommand.create({
        tableId,
        fields: {
          [titleFieldId]: 'Gamma',
        },
      })._unsafeUnwrap()
    );
    expect(missingRequiredResult.isErr()).toBe(true);
    if (missingRequiredResult.isErr()) {
      expect(missingRequiredResult.error.code).toBe('validation.field.not_null');
    }

    const duplicateCodeResult = await commandBus.execute(
      validationContext,
      CreateRecordCommand.create({
        tableId,
        fields: {
          [titleFieldId]: 'Delta',
          [codeFieldId]: 'CODE-001',
        },
      })._unsafeUnwrap()
    );
    expect(duplicateCodeResult.isErr()).toBe(true);
    if (duplicateCodeResult.isErr()) {
      expect(duplicateCodeResult.error.code).toBe('validation.field.unique');
    }

    (await commandBus.execute(context, redoCommand))._unsafeUnwrap();
    expect((await ctx.getTableById(tableId)).fields.some((field) => field.id === codeFieldId)).toBe(
      false
    );
  });

  it('undoes and redoes field type conversion with field values', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo Redo Update Field',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Score' },
      ],
      views: [{ type: 'grid' }],
    });
    const tableId = table.id;
    const titleFieldId = findFieldId(table, 'Title');
    const scoreFieldId = findFieldId(table, 'Score');
    const record = await ctx.createRecord(tableId, {
      [titleFieldId]: 'R1',
      [scoreFieldId]: '42',
    });
    const windowId = 'e2e-field-update';
    const context = buildContext(windowId);

    const updateCommand = UpdateFieldCommand.create({
      tableId,
      fieldId: scoreFieldId,
      field: {
        type: 'number',
      },
    })._unsafeUnwrap();
    const undoCommand = UndoCommand.create({ tableId, windowId })._unsafeUnwrap();
    const redoCommand = RedoCommand.create({ tableId, windowId })._unsafeUnwrap();

    (await commandBus.execute(context, updateCommand))._unsafeUnwrap();
    let updatedTable = await ctx.getTableById(tableId);
    expect(updatedTable.fields.find((field) => field.id === scoreFieldId)?.type).toBe('number');
    let updatedRecord = (await ctx.listRecords(tableId)).find((item) => item.id === record.id);
    expect(updatedRecord?.fields[scoreFieldId]).toBe(42);

    (await commandBus.execute(context, undoCommand))._unsafeUnwrap();
    updatedTable = await ctx.getTableById(tableId);
    expect(updatedTable.fields.find((field) => field.id === scoreFieldId)?.type).toBe(
      'singleLineText'
    );
    updatedRecord = (await ctx.listRecords(tableId)).find((item) => item.id === record.id);
    expect(updatedRecord?.fields[scoreFieldId]).toBe('42');

    (await commandBus.execute(context, redoCommand))._unsafeUnwrap();
    updatedTable = await ctx.getTableById(tableId);
    expect(updatedTable.fields.find((field) => field.id === scoreFieldId)?.type).toBe('number');
    updatedRecord = (await ctx.listRecords(tableId)).find((item) => item.id === record.id);
    expect(updatedRecord?.fields[scoreFieldId]).toBe(42);
  });

  it('undoes and redoes field duplication with copied values', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo Redo Duplicate Field',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
      views: [{ type: 'grid' }],
    });
    const tableId = table.id;
    const titleFieldId = findFieldId(table, 'Title');
    const amountFieldId = findFieldId(table, 'Amount');
    const record = await ctx.createRecord(tableId, {
      [titleFieldId]: 'R1',
      [amountFieldId]: 8,
    });
    const windowId = 'e2e-field-duplicate';
    const context = buildContext(windowId);

    const duplicateCommand = DuplicateFieldCommand.create({
      baseId: ctx.baseId,
      tableId,
      fieldId: amountFieldId,
      includeRecordValues: true,
    })._unsafeUnwrap();
    const undoCommand = UndoCommand.create({ tableId, windowId })._unsafeUnwrap();
    const redoCommand = RedoCommand.create({ tableId, windowId })._unsafeUnwrap();

    const duplicateResult = (
      await commandBus.execute<typeof duplicateCommand, DuplicateFieldResult>(
        context,
        duplicateCommand
      )
    )._unsafeUnwrap();
    const duplicatedFieldId = duplicateResult.newField.id().toString();

    let duplicatedRecord = (await ctx.listRecords(tableId)).find((item) => item.id === record.id);
    expect(duplicatedRecord?.fields[duplicatedFieldId]).toBe(8);

    (await commandBus.execute(context, undoCommand))._unsafeUnwrap();
    expect(
      (await ctx.getTableById(tableId)).fields.some((field) => field.id === duplicatedFieldId)
    ).toBe(false);

    (await commandBus.execute(context, redoCommand))._unsafeUnwrap();
    expect(
      (await ctx.getTableById(tableId)).fields.some((field) => field.id === duplicatedFieldId)
    ).toBe(true);
    duplicatedRecord = (await ctx.listRecords(tableId)).find((item) => item.id === record.id);
    expect(duplicatedRecord?.fields[duplicatedFieldId]).toBe(8);
  });

  it('restores conditional rollup values after undoing a deleted source field', async () => {
    const sourceNameFieldId = FieldId.generate()._unsafeUnwrap().toString();
    const sourcePriceFieldId = FieldId.generate()._unsafeUnwrap().toString();
    const hostNameFieldId = FieldId.generate()._unsafeUnwrap().toString();
    const linkFieldId = FieldId.generate()._unsafeUnwrap().toString();
    const lookupFieldId = FieldId.generate()._unsafeUnwrap().toString();
    const conditionalRollupFieldId = FieldId.generate()._unsafeUnwrap().toString();
    const sourceTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo Conditional Rollup Source',
      fields: [
        { type: 'singleLineText', id: sourceNameFieldId, name: 'Name', isPrimary: true },
        {
          type: 'number',
          id: sourcePriceFieldId,
          name: 'Price',
          options: { formatting: { type: 'decimal', precision: 0 } },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const sourceRecords = await ctx.createRecords(sourceTable.id, [
      { fields: { [sourceNameFieldId]: 'Item A', [sourcePriceFieldId]: 10 } },
      { fields: { [sourceNameFieldId]: 'Item B', [sourcePriceFieldId]: 20 } },
      { fields: { [sourceNameFieldId]: 'Item C', [sourcePriceFieldId]: 30 } },
    ]);
    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Undo Conditional Rollup Host',
      fields: [
        { type: 'singleLineText', id: hostNameFieldId, name: 'Order', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Product',
          options: {
            relationship: 'manyMany',
            foreignTableId: sourceTable.id,
            lookupFieldId: sourceNameFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTable.id,
      field: {
        type: 'lookup',
        id: lookupFieldId,
        name: 'Price Lookup',
        options: {
          foreignTableId: sourceTable.id,
          linkFieldId,
          lookupFieldId: sourcePriceFieldId,
        },
      },
    });
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTable.id,
      field: {
        type: 'conditionalRollup',
        id: conditionalRollupFieldId,
        name: 'Price Total',
        options: { expression: 'sum({values})' },
        config: {
          foreignTableId: sourceTable.id,
          lookupFieldId: sourcePriceFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: sourcePriceFieldId, operator: 'isGreater', value: 0 }],
            },
          },
        },
      },
    });
    const records = await ctx.createRecords(hostTable.id, [
      {
        fields: {
          [hostNameFieldId]: 'Order 1',
          [linkFieldId]: [{ id: sourceRecords[0]!.id }],
        },
      },
      { fields: { [hostNameFieldId]: 'Order 2' } },
      { fields: { [hostNameFieldId]: 'Order 3' } },
    ]);
    const record = records[0]!;
    await ctx.drainOutbox();
    const settledBeforeDelete = (await ctx.listRecords(hostTable.id)).find(
      (item) => item.id === record.id
    );
    expect(settledBeforeDelete?.fields[lookupFieldId]).toEqual([10]);
    expect(settledBeforeDelete?.fields[conditionalRollupFieldId]).toBe(60);

    const context = buildContext('e2e-undo-conditional-rollup');
    const deleteCommand = DeleteFieldCommand.create({
      baseId: ctx.baseId,
      tableId: sourceTable.id,
      fieldId: sourcePriceFieldId,
    })._unsafeUnwrap();
    const undoCommand = UndoCommand.create({
      tableId: sourceTable.id,
      windowId: 'e2e-undo-conditional-rollup',
    })._unsafeUnwrap();
    (await commandBus.execute(context, deleteCommand))._unsafeUnwrap();
    await ctx.drainOutbox();
    const deletedHost = (await ctx.getTableById(hostTable.id)).fields;
    expect(deletedHost.find((field) => field.id === lookupFieldId)?.hasError).toBe(true);
    expect(deletedHost.find((field) => field.id === conditionalRollupFieldId)?.hasError).toBe(true);

    (await commandBus.execute(context, undoCommand))._unsafeUnwrap();
    await ctx.drainOutbox();
    const restoredSource = await ctx.listRecords(sourceTable.id);
    expect(restoredSource.map((item) => item.fields[sourcePriceFieldId])).toEqual([10, 20, 30]);
    const restoredHostFields = (await ctx.getTableById(hostTable.id)).fields;
    expect(restoredHostFields.find((field) => field.id === lookupFieldId)?.hasError).toBeFalsy();
    expect(
      restoredHostFields.find((field) => field.id === conditionalRollupFieldId)?.hasError
    ).toBeFalsy();
    const restoredHost = (await ctx.listRecords(hostTable.id)).find(
      (item) => item.id === record.id
    );
    expect(restoredHost?.fields[lookupFieldId]).toEqual([10]);
    expect(restoredHost?.fields[conditionalRollupFieldId]).toBe(60);
  });
});
