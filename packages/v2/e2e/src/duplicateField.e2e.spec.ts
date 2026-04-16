import { duplicateFieldOkResponseSchema } from '@teable/v2-contract-http';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

type DuplicateFieldCase = {
  label: string;
  fieldType: string;
  fieldConfig?: Record<string, unknown>;
  recordValue: unknown;
  expectedCopiedValue: unknown;
  expectedNoCopyValue: unknown;
  setupNotes: string;
};

type DuplicateFieldErrorCase = {
  label: string;
  fieldType: string;
  fieldConfig?: Record<string, unknown>;
  recordValue: unknown;
  expectedError: string;
  setupNotes: string;
};

const duplicateFieldCases: DuplicateFieldCase[] = [
  {
    label: 'singleLineText',
    fieldType: 'singleLineText',
    fieldConfig: {},
    recordValue: 'Hello',
    expectedCopiedValue: 'Hello',
    expectedNoCopyValue: undefined,
    setupNotes:
      'Create table with primary Title + singleLineText field; set record value to "Hello".',
  },
  {
    label: 'longText',
    fieldType: 'longText',
    fieldConfig: {},
    recordValue: 'Long text value',
    expectedCopiedValue: 'Long text value',
    expectedNoCopyValue: undefined,
    setupNotes: 'Create table with primary Title + longText field; set record value.',
  },
  {
    label: 'number',
    fieldType: 'number',
    fieldConfig: {},
    recordValue: 123.45,
    expectedCopiedValue: 123.45,
    expectedNoCopyValue: undefined,
    setupNotes: 'Create table with primary Title + number field; set record value.',
  },
  {
    label: 'rating',
    fieldType: 'rating',
    fieldConfig: {},
    recordValue: 4,
    expectedCopiedValue: 4,
    expectedNoCopyValue: undefined,
    setupNotes: 'Create table with primary Title + rating field; set record value.',
  },
  {
    label: 'checkbox',
    fieldType: 'checkbox',
    fieldConfig: {},
    recordValue: true,
    expectedCopiedValue: true,
    expectedNoCopyValue: undefined,
    setupNotes: 'Create table with primary Title + checkbox field; set record value.',
  },
  {
    label: 'date',
    fieldType: 'date',
    fieldConfig: {},
    recordValue: '2024-01-02',
    expectedCopiedValue: '2024-01-02',
    expectedNoCopyValue: undefined,
    setupNotes: 'Create table with primary Title + date field; set ISO date string.',
  },
  {
    label: 'singleSelect',
    fieldType: 'singleSelect',
    fieldConfig: {
      options: [{ name: 'A', color: 'blue' }],
      defaultValue: { name: 'A', color: 'blue' },
    },
    recordValue: 'A',
    expectedCopiedValue: 'A',
    expectedNoCopyValue: undefined,
    setupNotes: 'Create table with primary Title + singleSelect field; select option A.',
  },
  {
    label: 'multipleSelect',
    fieldType: 'multipleSelect',
    fieldConfig: {
      options: [
        { name: 'A', color: 'blue' },
        { name: 'B', color: 'green' },
      ],
    },
    recordValue: ['A', 'B'],
    expectedCopiedValue: ['A', 'B'],
    expectedNoCopyValue: [],
    setupNotes: 'Create table with primary Title + multipleSelect field; select A+B.',
  },
  {
    label: 'user',
    fieldType: 'user',
    fieldConfig: {},
    recordValue: [{ id: 'usrTestUserId' }],
    expectedCopiedValue: [{ id: 'usrTestUserId' }],
    expectedNoCopyValue: [],
    setupNotes: 'Create table with primary Title + user field; set to ctx.testUser.',
  },
  {
    label: 'attachment',
    fieldType: 'attachment',
    fieldConfig: {},
    recordValue: [{ name: 'file.txt', url: 'https://example.com/file.txt' }],
    expectedCopiedValue: [{ name: 'file.txt', url: 'https://example.com/file.txt' }],
    expectedNoCopyValue: [],
    setupNotes: 'Create table with primary Title + attachment field; use fake attachment value.',
  },
  {
    label: 'formula',
    fieldType: 'formula',
    fieldConfig: { expression: '{Number} + 1' },
    recordValue: 2,
    expectedCopiedValue: 2,
    expectedNoCopyValue: 2,
    setupNotes:
      'Create table with number field + formula; create record with number=1; formula should read 2 on both source and duplicated field.',
  },
  {
    label: 'rollup',
    fieldType: 'rollup',
    fieldConfig: { expression: 'SUM(values)' },
    recordValue: 10,
    expectedCopiedValue: 10,
    expectedNoCopyValue: 10,
    setupNotes:
      'Create link + rollup; create linked records; ensure rollup value is computed; duplicated field should compute same.',
  },
  {
    label: 'conditionalRollup',
    fieldType: 'conditionalRollup',
    fieldConfig: { expression: 'SUM(values)' },
    recordValue: 10,
    expectedCopiedValue: 10,
    expectedNoCopyValue: 10,
    setupNotes:
      'Create conditionalRollup based on condition; computed value should match on duplicated field.',
  },
  {
    label: 'conditionalLookup',
    fieldType: 'conditionalLookup',
    fieldConfig: {},
    recordValue: 'Foo',
    expectedCopiedValue: 'Foo',
    expectedNoCopyValue: 'Foo',
    setupNotes:
      'Create conditionalLookup over foreign table; computed value should match on duplicated field.',
  },
  {
    label: 'createdTime',
    fieldType: 'createdTime',
    fieldConfig: {},
    recordValue: '<<timestamp>>',
    expectedCopiedValue: '<<timestamp>>',
    expectedNoCopyValue: '<<timestamp>>',
    setupNotes:
      'Create record and capture createdTime; duplicated field should read the same createdTime.',
  },
  {
    label: 'lastModifiedTime',
    fieldType: 'lastModifiedTime',
    fieldConfig: {},
    recordValue: '<<timestamp>>',
    expectedCopiedValue: '<<timestamp>>',
    expectedNoCopyValue: '<<timestamp>>',
    setupNotes: 'Update record to set lastModifiedTime; duplicated field should read same value.',
  },
  {
    label: 'createdBy',
    fieldType: 'createdBy',
    fieldConfig: {},
    recordValue: { id: 'usrTestUserId' },
    expectedCopiedValue: { id: 'usrTestUserId' },
    expectedNoCopyValue: { id: 'usrTestUserId' },
    setupNotes: 'Create record as ctx.testUser; duplicated field should show same user.',
  },
  {
    label: 'lastModifiedBy',
    fieldType: 'lastModifiedBy',
    fieldConfig: {},
    recordValue: { id: 'usrTestUserId' },
    expectedCopiedValue: { id: 'usrTestUserId' },
    expectedNoCopyValue: { id: 'usrTestUserId' },
    setupNotes: 'Update record as ctx.testUser; duplicated field should show same user.',
  },
  {
    label: 'autoNumber',
    fieldType: 'autoNumber',
    fieldConfig: {},
    recordValue: 1,
    expectedCopiedValue: 1,
    expectedNoCopyValue: 1,
    setupNotes:
      'Create record to get autoNumber; duplicated field should show same value for that record.',
  },
  {
    label: 'button',
    fieldType: 'button',
    fieldConfig: { label: 'Click', color: 'teal' },
    recordValue: null,
    expectedCopiedValue: null,
    expectedNoCopyValue: null,
    setupNotes: 'Button field may be non-storable; verify duplicated field remains null.',
  },
  {
    label: 'link manyMany',
    fieldType: 'link',
    fieldConfig: { relationship: 'manyMany' },
    recordValue: [{ id: '<<foreignRecordId>>' }],
    expectedCopiedValue: [{ id: '<<foreignRecordId>>' }],
    expectedNoCopyValue: [],
    setupNotes:
      'Create foreign table + records; set link values; duplicated field should reference same linked records.',
  },
  {
    label: 'link oneMany(one-way)',
    fieldType: 'link',
    fieldConfig: { relationship: 'oneMany', isOneWay: true },
    recordValue: [{ id: '<<foreignRecordId>>' }],
    expectedCopiedValue: [{ id: '<<foreignRecordId>>' }],
    expectedNoCopyValue: [],
    setupNotes:
      'Create foreign table + records; set link values; duplicated field should reference same linked records.',
  },
  {
    label: 'link manyOne',
    fieldType: 'link',
    fieldConfig: { relationship: 'manyOne' },
    recordValue: { id: '<<foreignRecordId>>' },
    expectedCopiedValue: { id: '<<foreignRecordId>>' },
    expectedNoCopyValue: null,
    setupNotes:
      'Create foreign table + records; set link value; duplicated field should reference same linked record.',
  },
  {
    label: 'link oneOne',
    fieldType: 'link',
    fieldConfig: { relationship: 'oneOne' },
    recordValue: { id: '<<foreignRecordId>>' },
    expectedCopiedValue: { id: '<<foreignRecordId>>' },
    expectedNoCopyValue: null,
    setupNotes:
      'Create foreign table + records; set link value; duplicated field should reference same linked record.',
  },
];

const duplicateFieldErrorCases: DuplicateFieldErrorCase[] = [
  {
    label: 'lookup',
    fieldType: 'lookup',
    fieldConfig: {},
    recordValue: '<<computed>>',
    expectedError: 'field.lookup_cannot_duplicate',
    setupNotes:
      'Create lookup field (link+lookup); duplicate should fail with lookup cannot duplicate error.',
  },
];

describe('duplicateField', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('respects viewId and updates duplicated field order in target view meta', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: `DupFieldViewOrder-${Date.now()}`,
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'Source' },
        { type: 'singleLineText', name: 'Tail' },
      ],
    });

    const targetView = table.views[0];
    const sourceField = table.fields.find((field) => field.name === 'Source');
    const tailField = table.fields.find((field) => field.name === 'Tail');

    expect(targetView).toBeTruthy();
    expect(sourceField).toBeTruthy();
    expect(tailField).toBeTruthy();
    if (!targetView || !sourceField || !tailField) return;

    const response = await fetch(`${ctx.baseUrl}/tables/duplicateField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        tableId: table.id,
        fieldId: sourceField.id,
        includeRecordValues: true,
        newFieldName: 'Source (copy)',
        viewId: targetView.id,
      }),
    });

    expect(response.status).toBe(200);
    const raw = await response.json();
    const parsed = duplicateFieldOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;

    const duplicatedFieldId = parsed.data.data.newFieldId;
    const latestTable = await ctx.getTableById(table.id);
    const latestView = latestTable.views.find((view) => view.id === targetView.id);
    expect(latestView).toBeTruthy();
    if (!latestView) return;

    const sourceOrder = latestView.columnMeta[sourceField.id]?.order;
    const tailOrder = latestView.columnMeta[tailField.id]?.order;
    const duplicatedOrder = latestView.columnMeta[duplicatedFieldId]?.order;

    expect(typeof sourceOrder).toBe('number');
    expect(typeof tailOrder).toBe('number');
    expect(typeof duplicatedOrder).toBe('number');
    expect((duplicatedOrder as number) > (sourceOrder as number)).toBe(true);
    expect((duplicatedOrder as number) < (tailOrder as number)).toBe(true);

    await ctx.deleteTable(table.id);
  });

  it('keeps symmetric field names unique after converting a duplicated one-way link back to two-way', async () => {
    let hostTableId: string | undefined;
    let foreignTableId: string | undefined;

    try {
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `DupLinkNameHost-${Date.now()}`,
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      hostTableId = hostTable.id;

      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `DupLinkNameForeign-${Date.now()}`,
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      });
      foreignTableId = foreignTable.id;

      const foreignPrimaryFieldId = foreignTable.fields.find((field) => field.isPrimary)?.id;
      expect(foreignPrimaryFieldId).toBeTruthy();
      if (!foreignPrimaryFieldId) return;

      const hostTableWithLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'link',
          name: 'Customer',
          options: {
            foreignTableId: foreignTable.id,
            relationship: 'manyMany',
            lookupFieldId: foreignPrimaryFieldId,
            isOneWay: false,
          },
        },
      });

      const originalField = hostTableWithLink.fields.find((field) => field.name === 'Customer');
      expect(originalField).toBeTruthy();
      if (!originalField) return;

      const originalSymmetricFieldId = (originalField.options as { symmetricFieldId?: string })
        .symmetricFieldId;
      expect(originalSymmetricFieldId).toBeTruthy();
      if (!originalSymmetricFieldId) return;

      const duplicateResponse = await fetch(`${ctx.baseUrl}/tables/duplicateField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          fieldId: originalField.id,
          includeRecordValues: true,
          newFieldName: 'Customer Copy',
        }),
      });

      expect(duplicateResponse.status).toBe(200);
      const duplicateRaw = await duplicateResponse.json();
      const duplicateParsed = duplicateFieldOkResponseSchema.safeParse(duplicateRaw);
      expect(duplicateParsed.success).toBe(true);
      expect(duplicateParsed.success && duplicateParsed.data.ok).toBe(true);
      if (!duplicateParsed.success || !duplicateParsed.data.ok) return;

      const duplicatedFieldId = duplicateParsed.data.data.newFieldId;

      const duplicatedTable = await ctx.getTableById(hostTable.id);
      const duplicatedField = duplicatedTable.fields.find(
        (field) => field.id === duplicatedFieldId
      );
      expect(duplicatedField?.type).toBe('link');
      expect((duplicatedField?.options as { isOneWay?: boolean })?.isOneWay).toBe(true);

      const updatedTable = await ctx.updateField({
        tableId: hostTable.id,
        fieldId: duplicatedFieldId,
        field: {
          options: {
            foreignTableId: foreignTable.id,
            relationship: 'manyMany',
            lookupFieldId: foreignPrimaryFieldId,
            isOneWay: false,
          },
        },
      });

      const updatedField = updatedTable.fields.find((field) => field.id === duplicatedFieldId);
      const newSymmetricFieldId = (updatedField?.options as { symmetricFieldId?: string })
        ?.symmetricFieldId;

      expect(newSymmetricFieldId).toBeTruthy();
      if (!newSymmetricFieldId) return;

      const foreignTableAfter = await ctx.getTableById(foreignTable.id);
      const originalSymmetricField = foreignTableAfter.fields.find(
        (field) => field.id === originalSymmetricFieldId
      );
      const newSymmetricField = foreignTableAfter.fields.find(
        (field) => field.id === newSymmetricFieldId
      );

      expect(originalSymmetricField?.name).toBeTruthy();
      expect(newSymmetricField?.name).toBeTruthy();
      expect(originalSymmetricField?.name).not.toBe(newSymmetricField?.name);
      expect(new Set([originalSymmetricField?.name, newSymmetricField?.name]).size).toBe(2);
    } finally {
      if (hostTableId) {
        await ctx.deleteTable(hostTableId);
      }
      if (foreignTableId) {
        await ctx.deleteTable(foreignTableId);
      }
    }
  });

  it('duplicates all field types with unique dbFieldName', async () => {
    let hostTableId: string | undefined;
    let foreignTableId: string | undefined;

    const condition = (fieldId: string, value: string) => ({
      filter: {
        conjunction: 'and' as const,
        filterSet: [{ fieldId, operator: 'is', value }],
      },
    });

    const duplicateAndAssert = async (fieldId: string, baseName: string) => {
      const before = await ctx.getTableById(hostTableId!);
      const source = before.fields.find((f) => f.id === fieldId);
      expect(source).toBeTruthy();
      expect(source?.dbFieldName).toBeTruthy();

      const response = await fetch(`${ctx.baseUrl}/tables/duplicateField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: hostTableId,
          fieldId,
          includeRecordValues: true,
          newFieldName: `${baseName}-copy-${Date.now()}`,
        }),
      });

      expect(response.status).toBe(200);
      const raw = await response.json();
      const parsed = duplicateFieldOkResponseSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) return;

      const after = await ctx.getTableById(hostTableId!);
      const duplicated = after.fields.find((f) => f.id === parsed.data.data.newFieldId);
      expect(duplicated).toBeTruthy();
      expect(duplicated?.dbFieldName).toBeTruthy();
      expect(duplicated?.dbFieldName).not.toBe(source?.dbFieldName);
    };

    try {
      const foreignStatusFieldId = `fld${'a'.repeat(16)}`;
      const foreignAmountFieldId = `fld${'b'.repeat(16)}`;
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `DupFieldForeign-${Date.now()}`,
        fields: [
          { type: 'singleLineText', name: 'Foreign Name', isPrimary: true },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
          { type: 'number', id: foreignAmountFieldId, name: 'Amount' },
        ],
      });
      foreignTableId = foreignTable.id;
      const foreignPrimaryField = foreignTable.fields.find((f) => f.isPrimary);
      if (!foreignPrimaryField) throw new Error('Missing foreign primary field');

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `DupFieldHost-${Date.now()}`,
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      hostTableId = hostTable.id;

      const createAndGetId = async (
        field: Parameters<SharedTestContext['createField']>[0]['field'],
        name: string
      ) => {
        const updated = await ctx.createField({
          baseId: ctx.baseId,
          tableId: hostTableId!,
          field,
        });
        const created = updated.fields.find((f) => f.name === name);
        if (!created) throw new Error(`Missing created field: ${name}`);
        return created.id;
      };

      const linkFieldId = await createAndGetId(
        {
          type: 'link',
          name: 'Link Field',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreignTableId!,
            lookupFieldId: foreignPrimaryField.id,
          },
        },
        'Link Field'
      );

      const numberFieldId = await createAndGetId(
        { type: 'number', name: 'Number Field' },
        'Number Field'
      );

      const allTypeFieldIds = [
        await createAndGetId({ type: 'singleLineText', name: 'Text Field' }, 'Text Field'),
        await createAndGetId({ type: 'longText', name: 'Long Text Field' }, 'Long Text Field'),
        numberFieldId,
        await createAndGetId({ type: 'rating', name: 'Rating Field' }, 'Rating Field'),
        await createAndGetId({ type: 'checkbox', name: 'Checkbox Field' }, 'Checkbox Field'),
        await createAndGetId({ type: 'date', name: 'Date Field' }, 'Date Field'),
        await createAndGetId(
          {
            type: 'singleSelect',
            name: 'Single Select Field',
            options: { choices: [{ name: 'A', color: 'blue' }] },
          },
          'Single Select Field'
        ),
        await createAndGetId(
          {
            type: 'multipleSelect',
            name: 'Multi Select Field',
            options: { choices: [{ name: 'A', color: 'blue' }] },
          },
          'Multi Select Field'
        ),
        await createAndGetId(
          { type: 'user', name: 'User Field', options: { isMultiple: true, shouldNotify: false } },
          'User Field'
        ),
        await createAndGetId({ type: 'attachment', name: 'Attachment Field' }, 'Attachment Field'),
        await createAndGetId(
          {
            type: 'formula',
            name: 'Formula Field',
            options: { expression: `{${numberFieldId}} + 1` },
          },
          'Formula Field'
        ),
        await createAndGetId(
          {
            type: 'lookup',
            name: 'Lookup Field',
            options: {
              linkFieldId,
              foreignTableId: foreignTableId!,
              lookupFieldId: foreignPrimaryField.id,
            },
          },
          'Lookup Field'
        ),
        await createAndGetId(
          {
            type: 'rollup',
            name: 'Rollup Field',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId,
              foreignTableId: foreignTableId!,
              lookupFieldId: foreignAmountFieldId,
            },
          },
          'Rollup Field'
        ),
        await createAndGetId(
          {
            type: 'conditionalLookup',
            name: 'Conditional Lookup Field',
            options: {
              foreignTableId: foreignTableId!,
              lookupFieldId: foreignPrimaryField.id,
              condition: condition(foreignStatusFieldId, 'Active'),
            },
          },
          'Conditional Lookup Field'
        ),
        await createAndGetId(
          {
            type: 'conditionalRollup',
            name: 'Conditional Rollup Field',
            options: { expression: 'sum({values})' },
            config: {
              foreignTableId: foreignTableId!,
              lookupFieldId: foreignAmountFieldId,
              condition: condition(foreignStatusFieldId, 'Active'),
            },
          },
          'Conditional Rollup Field'
        ),
        await createAndGetId(
          { type: 'createdTime', name: 'Created Time Field' },
          'Created Time Field'
        ),
        await createAndGetId(
          { type: 'lastModifiedTime', name: 'Last Modified Time Field' },
          'Last Modified Time Field'
        ),
        await createAndGetId({ type: 'createdBy', name: 'Created By Field' }, 'Created By Field'),
        await createAndGetId(
          { type: 'lastModifiedBy', name: 'Last Modified By Field' },
          'Last Modified By Field'
        ),
        await createAndGetId(
          { type: 'autoNumber', name: 'Auto Number Field' },
          'Auto Number Field'
        ),
        await createAndGetId(
          { type: 'button', name: 'Button Field', options: { label: 'Click', color: 'teal' } },
          'Button Field'
        ),
        linkFieldId,
      ];

      for (const fieldId of allTypeFieldIds) {
        await duplicateAndAssert(fieldId, `dup-${fieldId}`);
      }
    } finally {
      if (hostTableId) {
        await ctx.deleteTable(hostTableId).catch(() => undefined);
      }
      if (foreignTableId) {
        await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    }
  });

  it('T3235 preserves copied lookup values when converting the duplicate to basic fields', async () => {
    let hostTableId: string | undefined;
    let foreignTableId: string | undefined;

    try {
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `DupLookupSelectForeign-${Date.now()}`,
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'singleSelect',
            name: 'Status',
            options: {
              choices: [
                { id: 'choAlpha', name: 'Alpha', color: 'blueBright' },
                { id: 'choBeta', name: 'Beta', color: 'greenBright' },
              ],
            },
          },
          { type: 'number', name: 'Score' },
          { type: 'checkbox', name: 'Done' },
          { type: 'date', name: 'Due' },
        ],
      });
      foreignTableId = foreignTable.id;

      const findForeignFieldId = (name: string) =>
        foreignTable.fields.find((field) => field.name === name)?.id;

      const foreignPrimaryFieldId = foreignTable.fields.find((field) => field.isPrimary)?.id;
      const foreignStatusFieldId = findForeignFieldId('Status');
      const foreignScoreFieldId = findForeignFieldId('Score');
      const foreignDoneFieldId = findForeignFieldId('Done');
      const foreignDueFieldId = findForeignFieldId('Due');
      expect(foreignPrimaryFieldId).toBeTruthy();
      expect(foreignStatusFieldId).toBeTruthy();
      expect(foreignScoreFieldId).toBeTruthy();
      expect(foreignDoneFieldId).toBeTruthy();
      expect(foreignDueFieldId).toBeTruthy();
      if (
        !foreignPrimaryFieldId ||
        !foreignStatusFieldId ||
        !foreignScoreFieldId ||
        !foreignDoneFieldId ||
        !foreignDueFieldId
      )
        return;

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `DupLookupSelectHost-${Date.now()}`,
        fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
      });
      hostTableId = hostTable.id;
      const hostPrimaryFieldId = hostTable.fields.find((field) => field.isPrimary)?.id;
      expect(hostPrimaryFieldId).toBeTruthy();
      if (!hostPrimaryFieldId) return;

      const hostTableWithLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'link',
          name: 'Foreign',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryFieldId,
          },
        },
      });

      const linkFieldId = hostTableWithLink.fields.find((field) => field.name === 'Foreign')?.id;
      expect(linkFieldId).toBeTruthy();
      if (!linkFieldId) return;

      const createLookupFieldId = async (name: string, lookupFieldId: string) => {
        const hostTableWithLookup = await ctx.createField({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'lookup',
            name,
            options: {
              linkFieldId,
              foreignTableId: foreignTable.id,
              lookupFieldId,
            },
          },
        });

        const lookupId = hostTableWithLookup.fields.find((field) => field.name === name)?.id;
        expect(lookupId).toBeTruthy();
        if (!lookupId) throw new Error(`missing lookup field ${name}`);
        return lookupId;
      };

      const statusLookupFieldId = await createLookupFieldId('Status Lookup', foreignStatusFieldId);
      const scoreLookupFieldId = await createLookupFieldId('Score Lookup', foreignScoreFieldId);
      const doneLookupFieldId = await createLookupFieldId('Done Lookup', foreignDoneFieldId);
      const dueLookupFieldId = await createLookupFieldId('Due Lookup', foreignDueFieldId);

      const foreignRecord = await ctx.createRecord(foreignTable.id, {
        [foreignPrimaryFieldId]: 'Foreign 1',
        [foreignStatusFieldId]: 'Alpha',
        [foreignScoreFieldId]: 4.7,
        [foreignDoneFieldId]: true,
        [foreignDueFieldId]: '2024-01-02T00:00:00.000Z',
      });

      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'Host 1',
        [linkFieldId]: { id: foreignRecord.id },
      });

      await ctx.drainOutbox();

      const beforeRecords = await ctx.listRecordsWithoutDrain(hostTable.id);
      expect(
        beforeRecords.find((record) => record.id === hostRecord.id)?.fields[statusLookupFieldId]
      ).toEqual(['Alpha']);
      expect(
        beforeRecords.find((record) => record.id === hostRecord.id)?.fields[scoreLookupFieldId]
      ).toEqual([4.7]);
      expect(
        beforeRecords.find((record) => record.id === hostRecord.id)?.fields[doneLookupFieldId]
      ).toEqual([true]);

      const assertExpected = (actual: unknown, expected: unknown | ((actual: unknown) => void)) => {
        if (typeof expected === 'function') {
          expected(actual);
          return;
        }
        expect(actual).toEqual(expected);
      };

      const expectDate = (actual: unknown) => {
        expect(new Date(actual as string).toISOString()).toBe('2024-01-02T00:00:00.000Z');
      };

      const expectDateArray = (actual: unknown) => {
        expect(Array.isArray(actual)).toBe(true);
        expectDate((actual as unknown[])[0]);
      };

      const duplicateAndConvert = async ({
        lookupFieldId,
        targetField,
        copiedValue,
        expectedValue,
      }: {
        lookupFieldId: string;
        targetField: { type: string };
        copiedValue: unknown | ((actual: unknown) => void);
        expectedValue: unknown | ((actual: unknown) => void);
      }) => {
        const duplicateResponse = await fetch(`${ctx.baseUrl}/tables/duplicateField`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            baseId: ctx.baseId,
            tableId: hostTable.id,
            fieldId: lookupFieldId,
            includeRecordValues: true,
            newFieldName: `Lookup Copy ${targetField.type}`,
          }),
        });

        expect(duplicateResponse.status).toBe(200);
        const duplicateRaw = await duplicateResponse.json();
        const duplicateParsed = duplicateFieldOkResponseSchema.safeParse(duplicateRaw);
        expect(duplicateParsed.success).toBe(true);
        expect(duplicateParsed.success && duplicateParsed.data.ok).toBe(true);
        if (!duplicateParsed.success || !duplicateParsed.data.ok) return;

        const duplicatedFieldId = duplicateParsed.data.data.newFieldId;
        await ctx.drainOutbox();

        const afterDuplicateRecords = await ctx.listRecordsWithoutDrain(hostTable.id);
        assertExpected(
          afterDuplicateRecords.find((record) => record.id === hostRecord.id)?.fields[
            duplicatedFieldId
          ],
          copiedValue
        );

        await ctx.updateField({
          tableId: hostTable.id,
          fieldId: duplicatedFieldId,
          field: targetField as never,
        });

        const afterConvertRecords = await ctx.listRecords(hostTable.id);
        assertExpected(
          afterConvertRecords.find((record) => record.id === hostRecord.id)?.fields[
            duplicatedFieldId
          ],
          expectedValue
        );
      };

      await duplicateAndConvert({
        lookupFieldId: statusLookupFieldId,
        targetField: { type: 'singleLineText' },
        copiedValue: ['Alpha'],
        expectedValue: 'Alpha',
      });
      await duplicateAndConvert({
        lookupFieldId: statusLookupFieldId,
        targetField: { type: 'longText' },
        copiedValue: ['Alpha'],
        expectedValue: 'Alpha',
      });
      await duplicateAndConvert({
        lookupFieldId: scoreLookupFieldId,
        targetField: { type: 'number' },
        copiedValue: [4.7],
        expectedValue: 4.7,
      });
      await duplicateAndConvert({
        lookupFieldId: scoreLookupFieldId,
        targetField: { type: 'rating' },
        copiedValue: [4.7],
        expectedValue: 4,
      });
      await duplicateAndConvert({
        lookupFieldId: doneLookupFieldId,
        targetField: { type: 'checkbox' },
        copiedValue: [true],
        expectedValue: true,
      });
      await duplicateAndConvert({
        lookupFieldId: dueLookupFieldId,
        targetField: { type: 'date' },
        copiedValue: expectDateArray,
        expectedValue: expectDate,
      });
      await duplicateAndConvert({
        lookupFieldId: statusLookupFieldId,
        targetField: { type: 'singleSelect' },
        copiedValue: ['Alpha'],
        expectedValue: 'Alpha',
      });
      await duplicateAndConvert({
        lookupFieldId: statusLookupFieldId,
        targetField: { type: 'multipleSelect' },
        copiedValue: ['Alpha'],
        expectedValue: ['Alpha'],
      });
    } finally {
      if (hostTableId) {
        await ctx.deleteTable(hostTableId).catch(() => undefined);
      }
      if (foreignTableId) {
        await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    }
  });

  describe.each(duplicateFieldCases)('duplicate field with values: $label', (caseInfo) => {
    it.todo(`includeRecordValues=true should copy values; setup: ${caseInfo.setupNotes}`);
  });

  describe.each(duplicateFieldCases)('duplicate field without values: $label', (caseInfo) => {
    it.todo(`includeRecordValues=false should not copy values; setup: ${caseInfo.setupNotes}`);
  });

  describe.each(duplicateFieldErrorCases)('duplicate field error: $label', (caseInfo) => {
    it.todo(`should fail with ${caseInfo.expectedError}; setup: ${caseInfo.setupNotes}`);
  });
});
