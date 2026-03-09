/* eslint-disable @typescript-eslint/naming-convention */
import { FieldId, type ICreateFieldCommandInput } from '@teable/v2-core';
import { allFieldTypesTemplate } from '@teable/v2-table-templates';
import { expect } from 'vitest';

import type { SharedTestContext } from '../../../shared/globalTestContext';

type MatrixField = {
  id: string;
  name: string;
  type: string;
  description?: string | null;
  isLookup?: boolean;
  lookupOptions?: Record<string, unknown>;
  conditionalLookupOptions?: Record<string, unknown>;
};

type MatrixTable = {
  id: string;
  name: string;
  fields: MatrixField[];
  views: Array<{ id: string }>;
};

export type FieldUndoRedoMatrixEnv = {
  hostTableId: string;
  foreignTableId: string;
  getHostTable(): Promise<MatrixTable>;
  getForeignTable(): Promise<MatrixTable>;
  hostFieldId(name: string): Promise<string>;
  foreignFieldId(name: string): Promise<string>;
};

export type FieldMatrixCase = {
  key: string;
  type: string;
  buildField(env: FieldUndoRedoMatrixEnv, sequence: number): Promise<Record<string, unknown>>;
  assertPersistedField?(
    field: MatrixField | undefined,
    input: Record<string, unknown>
  ): Promise<void> | void;
};

const findFieldId = (table: MatrixTable, name: string) => {
  const fieldId = table.fields.find((field) => field.name === name)?.id;
  if (!fieldId) {
    throw new Error(`Missing field ${name} on ${table.name}`);
  }
  return fieldId;
};

const uniqueField = (type: string, sequence: number) => ({
  id: FieldId.mustGenerate().toString(),
  name: `Undo ${type} ${sequence}`,
});

export const asMatrixCreateFieldInput = (
  field: Record<string, unknown>
): ICreateFieldCommandInput['field'] => field as ICreateFieldCommandInput['field'];

export const createFieldUndoRedoMatrixEnv = async (
  ctx: SharedTestContext,
  namePrefix: string
): Promise<FieldUndoRedoMatrixEnv> => {
  const created = await ctx.createTables(
    allFieldTypesTemplate.createInput(ctx.baseId, { namePrefix, includeRecords: true })
  );

  const host = created.find((table) => table.name.endsWith('All Field Types'));
  const foreign = created.find((table) => table.name.endsWith('Companies'));

  if (!host || !foreign) {
    throw new Error('Failed to create field matrix tables');
  }

  let currentHost = host;
  const amountFieldId = findFieldId(currentHost, 'Amount');

  for (const field of [
    {
      type: 'createdTime',
      name: 'Matrix Created Time',
      options: { formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' } },
    },
    {
      type: 'lastModifiedTime',
      name: 'Matrix Last Modified Time',
      options: {
        formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
        trackedFieldIds: [amountFieldId],
      },
    },
    { type: 'createdBy', name: 'Matrix Created By' },
    {
      type: 'lastModifiedBy',
      name: 'Matrix Last Modified By',
      options: { trackedFieldIds: [amountFieldId] },
    },
    { type: 'autoNumber', name: 'Matrix Auto Number' },
  ] as const) {
    currentHost = await ctx.createField({
      baseId: ctx.baseId,
      tableId: currentHost.id,
      field: field as ICreateFieldCommandInput['field'],
    });
  }

  return {
    hostTableId: currentHost.id,
    foreignTableId: foreign.id,
    getHostTable: () => ctx.getTableById(currentHost.id) as Promise<MatrixTable>,
    getForeignTable: () => ctx.getTableById(foreign.id) as Promise<MatrixTable>,
    hostFieldId: async (name: string) => findFieldId(await ctx.getTableById(currentHost.id), name),
    foreignFieldId: async (name: string) => findFieldId(await ctx.getTableById(foreign.id), name),
  };
};

export const fieldMatrixCases: FieldMatrixCase[] = [
  {
    key: 'singleLineText',
    type: 'singleLineText',
    buildField: async (_env, sequence) => ({
      ...uniqueField('singleLineText', sequence),
      type: 'singleLineText',
      options: { showAs: { type: 'email' }, defaultValue: 'matrix@example.com' },
    }),
  },
  {
    key: 'longText',
    type: 'longText',
    buildField: async (_env, sequence) => ({
      ...uniqueField('longText', sequence),
      type: 'longText',
      options: { defaultValue: 'matrix long text' },
    }),
  },
  {
    key: 'number',
    type: 'number',
    buildField: async (_env, sequence) => ({
      ...uniqueField('number', sequence),
      type: 'number',
      options: {
        formatting: { type: 'currency', precision: 2, symbol: '$' },
        showAs: { type: 'bar', color: 'green', showValue: true, maxValue: 100 },
      },
    }),
  },
  {
    key: 'rating',
    type: 'rating',
    buildField: async (_env, sequence) => ({
      ...uniqueField('rating', sequence),
      type: 'rating',
      options: { max: 5, icon: 'star', color: 'yellowBright' },
    }),
  },
  {
    key: 'singleSelect',
    type: 'singleSelect',
    buildField: async (_env, sequence) => ({
      ...uniqueField('singleSelect', sequence),
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'Todo', color: 'blue' },
          { name: 'Done', color: 'green' },
        ],
        defaultValue: 'Todo',
      },
    }),
  },
  {
    key: 'multipleSelect',
    type: 'multipleSelect',
    buildField: async (_env, sequence) => ({
      ...uniqueField('multipleSelect', sequence),
      type: 'multipleSelect',
      options: {
        choices: [
          { name: 'Frontend', color: 'purple' },
          { name: 'Backend', color: 'orange' },
        ],
      },
    }),
  },
  {
    key: 'checkbox',
    type: 'checkbox',
    buildField: async (_env, sequence) => ({
      ...uniqueField('checkbox', sequence),
      type: 'checkbox',
      options: { defaultValue: true },
    }),
  },
  {
    key: 'attachment',
    type: 'attachment',
    buildField: async (_env, sequence) => ({
      ...uniqueField('attachment', sequence),
      type: 'attachment',
    }),
  },
  {
    key: 'date',
    type: 'date',
    buildField: async (_env, sequence) => ({
      ...uniqueField('date', sequence),
      type: 'date',
      options: { formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' } },
    }),
  },
  {
    key: 'createdTime',
    type: 'createdTime',
    buildField: async (_env, sequence) => ({
      ...uniqueField('createdTime', sequence),
      type: 'createdTime',
      options: { formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' } },
    }),
  },
  {
    key: 'lastModifiedTime',
    type: 'lastModifiedTime',
    buildField: async (env, sequence) => ({
      ...uniqueField('lastModifiedTime', sequence),
      type: 'lastModifiedTime',
      options: {
        formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
        trackedFieldIds: [await env.hostFieldId('Amount')],
      },
    }),
  },
  {
    key: 'user',
    type: 'user',
    buildField: async (_env, sequence) => ({
      ...uniqueField('user', sequence),
      type: 'user',
      options: { isMultiple: true, shouldNotify: false },
    }),
  },
  {
    key: 'createdBy',
    type: 'createdBy',
    buildField: async (_env, sequence) => ({
      ...uniqueField('createdBy', sequence),
      type: 'createdBy',
    }),
  },
  {
    key: 'lastModifiedBy',
    type: 'lastModifiedBy',
    buildField: async (env, sequence) => ({
      ...uniqueField('lastModifiedBy', sequence),
      type: 'lastModifiedBy',
      options: { trackedFieldIds: [await env.hostFieldId('Amount')] },
    }),
  },
  {
    key: 'autoNumber',
    type: 'autoNumber',
    buildField: async (_env, sequence) => ({
      ...uniqueField('autoNumber', sequence),
      type: 'autoNumber',
    }),
  },
  {
    key: 'button',
    type: 'button',
    buildField: async (_env, sequence) => ({
      ...uniqueField('button', sequence),
      type: 'button',
      options: {
        label: 'Run',
        color: 'teal',
        maxCount: 3,
        resetCount: true,
        workflow: { id: 'wflaaaaaaaaaaaaaaaa', name: 'Deploy', isActive: true },
      },
    }),
  },
  {
    key: 'formula',
    type: 'formula',
    buildField: async (env, sequence) => ({
      ...uniqueField('formula', sequence),
      type: 'formula',
      options: {
        expression: `{${await env.hostFieldId('Amount')}} * 3`,
        formatting: { type: 'decimal', precision: 0 },
      },
    }),
  },
  {
    key: 'link',
    type: 'link',
    buildField: async (env, sequence) => ({
      ...uniqueField('link', sequence),
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: env.foreignTableId,
        lookupFieldId: await env.foreignFieldId('Name'),
        isOneWay: true,
      },
    }),
  },
  {
    key: 'lookup',
    type: 'lookup',
    buildField: async (env, sequence) => ({
      ...uniqueField('lookup', sequence),
      type: 'lookup',
      options: {
        linkFieldId: await env.hostFieldId('Company'),
        foreignTableId: env.foreignTableId,
        lookupFieldId: await env.foreignFieldId('Name'),
      },
    }),
    assertPersistedField: (field, input) => {
      expect(field).toBeTruthy();
      expect(field?.isLookup).toBe(true);
      expect(field?.type).toBe('singleLineText');
      expect(field?.lookupOptions).toMatchObject((input.options ?? {}) as Record<string, unknown>);
    },
  },
  {
    key: 'rollup',
    type: 'rollup',
    buildField: async (env, sequence) => ({
      ...uniqueField('rollup', sequence),
      type: 'rollup',
      options: { expression: 'sum({values})' },
      config: {
        linkFieldId: await env.hostFieldId('Company'),
        foreignTableId: env.foreignTableId,
        lookupFieldId: await env.foreignFieldId('Revenue'),
      },
    }),
  },
  {
    key: 'conditionalLookup',
    type: 'conditionalLookup',
    buildField: async (env, sequence) => ({
      ...uniqueField('conditionalLookup', sequence),
      type: 'conditionalLookup',
      options: {
        foreignTableId: env.foreignTableId,
        lookupFieldId: await env.foreignFieldId('Name'),
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: await env.foreignFieldId('Revenue'),
                operator: 'isGreater',
                value: 100,
              },
            ],
          },
        },
      },
    }),
    assertPersistedField: (field, input) => {
      expect(field).toBeTruthy();
      expect(field?.isLookup).toBe(true);
      expect(field?.type).toBe('singleLineText');
      expect(field?.conditionalLookupOptions).toMatchObject(
        (input.options ?? {}) as Record<string, unknown>
      );
    },
  },
  {
    key: 'conditionalRollup',
    type: 'conditionalRollup',
    buildField: async (env, sequence) => ({
      ...uniqueField('conditionalRollup', sequence),
      type: 'conditionalRollup',
      options: { expression: 'sum({values})' },
      config: {
        foreignTableId: env.foreignTableId,
        lookupFieldId: await env.foreignFieldId('Revenue'),
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: await env.foreignFieldId('Revenue'),
                operator: 'isGreater',
                value: 100,
              },
            ],
          },
        },
      },
    }),
  },
];

export const assertFieldMatrixCasePersisted = async (
  fieldCase: FieldMatrixCase,
  field: MatrixField | undefined,
  input: Record<string, unknown>
) => {
  if (fieldCase.assertPersistedField) {
    await fieldCase.assertPersistedField(field, input);
    return;
  }

  expect(field).toBeTruthy();
  expect(field?.type).toBe(fieldCase.type);
};
