/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../shared/globalTestContext';
import { expectFieldOptions } from './helpers';

type OptionCase = {
  key: string;
  type: string;
  options: Record<string, unknown>;
  expected: Record<string, unknown>;
};

const optionCases: OptionCase[] = [
  {
    key: 'longText markdown',
    type: 'longText',
    options: { showAs: { type: 'markdown' }, defaultValue: 'matrix notes' },
    expected: { showAs: { type: 'markdown' }, defaultValue: 'matrix notes' },
  },
  {
    key: 'singleLineText email',
    type: 'singleLineText',
    options: { showAs: { type: 'email' }, defaultValue: 'matrix@example.com' },
    expected: { showAs: { type: 'email' }, defaultValue: 'matrix@example.com' },
  },
  {
    key: 'number currency bar',
    type: 'number',
    options: {
      formatting: { type: 'currency', precision: 2, symbol: '$' },
      showAs: { type: 'bar', color: 'green', showValue: true, maxValue: 100 },
      defaultValue: 42,
    },
    expected: {
      formatting: { type: 'currency', precision: 2, symbol: '$' },
      showAs: { type: 'bar', color: 'green', showValue: true, maxValue: 100 },
      defaultValue: 42,
    },
  },
  {
    key: 'rating',
    type: 'rating',
    options: { max: 5, icon: 'star', color: 'yellowBright' },
    expected: { max: 5, icon: 'star', color: 'yellowBright' },
  },
  {
    key: 'singleSelect choices',
    type: 'singleSelect',
    options: {
      choices: [
        { name: 'Todo', color: 'blue' },
        { name: 'Done', color: 'green' },
      ],
      defaultValue: 'Todo',
    },
    expected: { defaultValue: 'Todo' },
  },
  {
    key: 'multipleSelect choices',
    type: 'multipleSelect',
    options: {
      choices: [
        { name: 'Frontend', color: 'purple' },
        { name: 'Backend', color: 'orange' },
      ],
    },
    expected: {},
  },
  {
    key: 'checkbox default',
    type: 'checkbox',
    options: { defaultValue: true },
    expected: { defaultValue: true },
  },
  {
    key: 'date formatting',
    type: 'date',
    options: { formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' } },
    expected: { formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' } },
  },
  {
    key: 'user multi',
    type: 'user',
    options: { isMultiple: true, shouldNotify: false },
    expected: { isMultiple: true, shouldNotify: false },
  },
  {
    key: 'button',
    type: 'button',
    options: { label: 'Run', color: 'teal', maxCount: 3, resetCount: true },
    expected: { label: 'Run', color: 'teal', maxCount: 3, resetCount: true },
  },
  {
    key: 'createdTime formatting',
    type: 'createdTime',
    options: { formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' } },
    expected: { formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' } },
  },
  {
    key: 'lastModifiedTime formatting',
    type: 'lastModifiedTime',
    options: { formatting: { date: 'M/D/YYYY', time: 'None', timeZone: 'utc' } },
    expected: { formatting: { date: 'M/D/YYYY', time: 'None', timeZone: 'utc' } },
  },
  {
    key: 'formula formatting',
    type: 'formula',
    options: {
      expression: '1 + 1',
      formatting: { type: 'decimal', precision: 2 },
    },
    expected: {
      expression: '1 + 1',
      formatting: { type: 'decimal', precision: 2 },
    },
  },
  {
    key: 'singleSelect preventAutoNewOptions',
    type: 'singleSelect',
    options: {
      choices: [
        { name: 'Open', color: 'blue' },
        { name: 'Closed', color: 'red' },
      ],
      preventAutoNewOptions: true,
    },
    expected: { preventAutoNewOptions: true },
  },
];

const choiceNames = (field: { options?: unknown } | undefined) => {
  const options = field?.options;
  if (!options || typeof options !== 'object' || !('choices' in options)) return [];
  const { choices } = options;
  if (!Array.isArray(choices)) return [];
  return choices
    .filter((choice): choice is { name: string } => {
      return (
        typeof choice === 'object' &&
        choice != null &&
        'name' in choice &&
        typeof choice.name === 'string'
      );
    })
    .map((choice) => choice.name)
    .sort();
};

describe('update-field: option preservation matrix (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Option Preservation Matrix',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) {
      try {
        await ctx.deleteTable(tableId);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test.each(optionCases)(
    'keeps $key after create, name-only update, and empty-options convert',
    async (fieldCase) => {
      const fieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          id: fieldId,
          type: fieldCase.type,
          name: fieldCase.key,
          options: fieldCase.options,
        } as never,
      });

      let table = await ctx.getTableById(tableId);
      let field = table.fields.find((item) => item.id === fieldId);
      expect(field?.type).toBe(fieldCase.type);
      expectFieldOptions(field, fieldCase.expected);
      if (fieldCase.type === 'singleSelect' || fieldCase.type === 'multipleSelect') {
        expect(choiceNames(field)).toEqual(
          (fieldCase.options.choices as Array<{ name: string }>).map((choice) => choice.name).sort()
        );
      }

      table = await ctx.updateField({
        tableId,
        fieldId,
        field: {
          name: `${fieldCase.key} renamed`,
          description: 'name-only update must not drop options',
        },
      });
      field = table.fields.find((item) => item.id === fieldId);
      expect(field?.name).toBe(`${fieldCase.key} renamed`);
      expectFieldOptions(field, fieldCase.expected);
      if (fieldCase.type === 'singleSelect' || fieldCase.type === 'multipleSelect') {
        expect(choiceNames(field)).toEqual(
          (fieldCase.options.choices as Array<{ name: string }>).map((choice) => choice.name).sort()
        );
      }

      table = await ctx.updateField({
        tableId,
        fieldId,
        field: {
          type: fieldCase.type,
          name: `${fieldCase.key} empty options`,
          options: {},
        } as never,
      });
      field = table.fields.find((item) => item.id === fieldId);
      expectFieldOptions(field, fieldCase.expected);
      if (fieldCase.type === 'singleSelect' || fieldCase.type === 'multipleSelect') {
        expect(choiceNames(field)).toEqual(
          (fieldCase.options.choices as Array<{ name: string }>).map((choice) => choice.name).sort()
        );
      }

      await ctx.deleteField({ tableId, fieldId });
    }
  );

  test('keeps lastModifiedBy trackedFieldIds after name-only update', async () => {
    const host = await ctx.getTableById(tableId);
    const primary = host.fields.find((field) => field.isPrimary);
    if (!primary) throw new Error('primary field missing');
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        id: fieldId,
        type: 'lastModifiedBy',
        name: 'Editor',
        options: { trackedFieldIds: [primary.id] },
      },
    });
    const updated = await ctx.updateField({
      tableId,
      fieldId,
      field: { name: 'Editor renamed' },
    });
    expectFieldOptions(
      updated.fields.find((item) => item.id === fieldId),
      { trackedFieldIds: [primary.id] }
    );
    await ctx.deleteField({ tableId, fieldId });
  });

  test('keeps link relationship after name-only update', async () => {
    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Option Preservation Foreign',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        id: fieldId,
        type: 'link',
        name: 'Related',
        options: {
          relationship: 'manyOne',
          foreignTableId: foreign.id,
          lookupFieldId: foreign.fields[0].id,
          isOneWay: true,
        },
      },
    });
    const updated = await ctx.updateField({
      tableId,
      fieldId,
      field: { name: 'Related renamed' },
    });
    expectFieldOptions(
      updated.fields.find((item) => item.id === fieldId),
      {
        relationship: 'manyOne',
        foreignTableId: foreign.id,
        isOneWay: true,
      }
    );
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteTable(foreign.id);
  });

  test('keeps rollup expression after name-only update', async () => {
    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Option Preservation Rollup Src',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
    });
    const amount = foreign.fields.find((field) => field.name === 'Amount');
    if (!amount) throw new Error('Amount missing');
    const linkId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        id: linkId,
        type: 'link',
        name: 'Orders',
        options: {
          relationship: 'manyMany',
          foreignTableId: foreign.id,
          lookupFieldId: foreign.fields[0].id,
          isOneWay: true,
        },
      },
    });
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        id: fieldId,
        type: 'rollup',
        name: 'Order Total',
        options: { expression: 'sum({values})' },
        config: {
          linkFieldId: linkId,
          foreignTableId: foreign.id,
          lookupFieldId: amount.id,
        },
      },
    });
    const updated = await ctx.updateField({
      tableId,
      fieldId,
      field: { name: 'Order Total renamed' },
    });
    expectFieldOptions(
      updated.fields.find((item) => item.id === fieldId),
      {
        expression: 'sum({values})',
      }
    );
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteField({ tableId, fieldId: linkId });
    await ctx.deleteTable(foreign.id);
  });
});
