import { duplicateFieldOkResponseSchema } from '@teable/v2-contract-http';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';
import {
  ensureAttachmentTables,
  makeAttachmentCell,
  seedAttachment,
} from './update-field/attachment/testUtils';

describe('duplicateField', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  const duplicateField = async (payload: {
    tableId: string;
    fieldId: string;
    includeRecordValues: boolean;
    newFieldName: string;
  }): Promise<string> => {
    const response = await fetch(`${ctx.baseUrl}/tables/duplicateField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseId: ctx.baseId, ...payload }),
    });
    const raw = await response.json();
    if (response.status !== 200) {
      throw new Error(`duplicateField failed for ${payload.fieldId}: ${JSON.stringify(raw)}`);
    }
    const parsed = duplicateFieldOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`duplicateField response invalid: ${JSON.stringify(raw)}`);
    }
    return parsed.data.data.newFieldId;
  };

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
        expectedValue: 5,
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

  // v1 reference: field-duplicate.e2e-spec.ts
  //   - "duplicate all common fields"
  //   - "should duplicate text/number/checkbox fields and preserve all cell values"
  it('[V1 PARITY] copies cell values and options for common field types when includeRecordValues=true', async () => {
    let tableId: string | undefined;

    try {
      await ensureAttachmentTables(ctx);
      const seededAttachment = await seedAttachment(ctx);
      const attachmentCell = makeAttachmentCell(seededAttachment, 'dup-field.txt');

      const numberFieldId = `fld${'dupnum'.padEnd(16, '0')}`;
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `DupCommonFields-${Date.now()}`,
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', name: 'Text' },
          { type: 'longText', name: 'Long' },
          { type: 'number', id: numberFieldId, name: 'Num' },
          {
            type: 'rating',
            name: 'Rate',
            options: { max: 5, icon: 'star', color: 'yellowBright' },
          },
          { type: 'checkbox', name: 'Check' },
          { type: 'date', name: 'Due' },
          {
            type: 'singleSelect',
            name: 'Status',
            options: {
              choices: [
                { id: 'choDupA', name: 'A', color: 'blue' },
                { id: 'choDupB', name: 'B', color: 'green' },
              ],
              defaultValue: 'A',
            },
          },
          {
            type: 'multipleSelect',
            name: 'Tags',
            options: {
              choices: [
                { id: 'choDupX', name: 'X', color: 'purple' },
                { id: 'choDupY', name: 'Y', color: 'orange' },
              ],
            },
          },
          { type: 'user', name: 'Owner', options: { isMultiple: false, shouldNotify: false } },
          { type: 'attachment', name: 'Files' },
          { type: 'button', name: 'Action', options: { label: 'Click', color: 'teal' } },
          { type: 'formula', name: 'Score', options: { expression: `{${numberFieldId}} + 1` } },
          { type: 'autoNumber', name: 'Auto' },
          { type: 'createdTime', name: 'CTime' },
          { type: 'lastModifiedTime', name: 'MTime' },
          { type: 'createdBy', name: 'CBy' },
          { type: 'lastModifiedBy', name: 'MBy' },
        ],
      });
      tableId = table.id;

      const fieldIdByName = new Map(table.fields.map((field) => [field.name, field.id]));
      const requireFieldId = (name: string): string => {
        const id = fieldIdByName.get(name);
        if (!id) throw new Error(`Missing field ${name}`);
        return id;
      };

      const filledRecord = await ctx.createRecord(table.id, {
        [requireFieldId('Name')]: 'Row 1',
        [requireFieldId('Text')]: 'Hello',
        [requireFieldId('Long')]: 'Long text value',
        [requireFieldId('Num')]: 123.45,
        [requireFieldId('Rate')]: 4,
        [requireFieldId('Check')]: true,
        [requireFieldId('Due')]: '2024-01-02T00:00:00.000Z',
        [requireFieldId('Status')]: 'A',
        [requireFieldId('Tags')]: ['X', 'Y'],
        [requireFieldId('Owner')]: { id: ctx.testUser.id, title: ctx.testUser.name },
        [requireFieldId('Files')]: attachmentCell,
      });
      // T6520: unchecked checkbox is stored as null; the duplicated field must
      // preserve that (no false backfill on the copied column).
      const emptyRecord = await ctx.createRecord(table.id, {
        [requireFieldId('Name')]: 'Row 2',
      });

      await ctx.drainOutbox();

      const duplicatedNames = [
        'Text',
        'Long',
        'Num',
        'Rate',
        'Check',
        'Due',
        'Status',
        'Tags',
        'Owner',
        'Files',
        'Action',
        'Score',
        'Auto',
        'CTime',
        'MTime',
        'CBy',
        'MBy',
      ];

      const duplicatedIdByName = new Map<string, string>();
      for (const name of duplicatedNames) {
        const newFieldId = await duplicateField({
          tableId: table.id,
          fieldId: requireFieldId(name),
          includeRecordValues: true,
          newFieldName: `${name} copy`,
        });
        duplicatedIdByName.set(name, newFieldId);
      }

      await ctx.drainOutbox();

      const latestTable = await ctx.getTableById(table.id);
      for (const name of duplicatedNames) {
        const sourceField = latestTable.fields.find((field) => field.id === requireFieldId(name));
        const duplicatedField = latestTable.fields.find(
          (field) => field.id === duplicatedIdByName.get(name)
        );
        expect(duplicatedField, `duplicated field ${name}`).toBeTruthy();
        expect(duplicatedField?.type).toBe(sourceField?.type);
        // v1 parity: options are preserved verbatim (select choices, button
        // label/color, formula expression, default values, ...).
        expect(duplicatedField?.options, `options of ${name}`).toEqual(sourceField?.options);
      }

      const records = await ctx.listRecordsWithoutDrain(table.id);
      const filled = records.find((record) => record.id === filledRecord.id);
      const empty = records.find((record) => record.id === emptyRecord.id);
      expect(filled).toBeTruthy();
      expect(empty).toBeTruthy();
      if (!filled || !empty) return;

      for (const name of duplicatedNames) {
        const sourceId = requireFieldId(name);
        const duplicatedId = duplicatedIdByName.get(name);
        if (!duplicatedId) throw new Error(`Missing duplicated field id for ${name}`);
        expect(filled.fields[duplicatedId] ?? null, `copied value of ${name}`).toEqual(
          filled.fields[sourceId] ?? null
        );
        expect(empty.fields[duplicatedId] ?? null, `copied empty value of ${name}`).toEqual(
          empty.fields[sourceId] ?? null
        );
      }

      // T6520: unchecked checkbox must stay empty (null) on the copy.
      const checkCopyId = duplicatedIdByName.get('Check');
      expect(checkCopyId).toBeTruthy();
      if (checkCopyId) {
        expect(filled.fields[checkCopyId]).toBe(true);
        expect(empty.fields[checkCopyId] ?? null).toBeNull();
      }
    } finally {
      if (tableId) {
        await ctx.deleteTable(tableId).catch(() => undefined);
      }
    }
  });

  // v1 reference: field-duplicate.e2e-spec.ts "duplicate field" without copying
  // record values (duplicate options only).
  it('[V1 PARITY] does not copy stored values when includeRecordValues=false but recomputes computed fields', async () => {
    let tableId: string | undefined;

    try {
      const numberFieldId = `fld${'dupncv'.padEnd(16, '0')}`;
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `DupNoCopy-${Date.now()}`,
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', name: 'Text' },
          { type: 'number', id: numberFieldId, name: 'Num' },
          { type: 'checkbox', name: 'Check' },
          {
            type: 'singleSelect',
            name: 'Status',
            options: { choices: [{ id: 'choNoCopyA', name: 'A', color: 'blue' }] },
          },
          {
            type: 'multipleSelect',
            name: 'Tags',
            options: { choices: [{ id: 'choNoCopyX', name: 'X', color: 'purple' }] },
          },
          { type: 'formula', name: 'Score', options: { expression: `{${numberFieldId}} + 1` } },
          { type: 'autoNumber', name: 'Auto' },
        ],
      });
      tableId = table.id;

      const fieldIdByName = new Map(table.fields.map((field) => [field.name, field.id]));
      const requireFieldId = (name: string): string => {
        const id = fieldIdByName.get(name);
        if (!id) throw new Error(`Missing field ${name}`);
        return id;
      };

      const record = await ctx.createRecord(table.id, {
        [requireFieldId('Name')]: 'Row 1',
        [requireFieldId('Text')]: 'Hello',
        [requireFieldId('Num')]: 1,
        [requireFieldId('Check')]: true,
        [requireFieldId('Status')]: 'A',
        [requireFieldId('Tags')]: ['X'],
      });

      await ctx.drainOutbox();

      const staticNames = ['Text', 'Num', 'Check', 'Status', 'Tags'];
      const computedNames = ['Score', 'Auto'];
      const duplicatedIdByName = new Map<string, string>();
      for (const name of [...staticNames, ...computedNames]) {
        const newFieldId = await duplicateField({
          tableId: table.id,
          fieldId: requireFieldId(name),
          includeRecordValues: false,
          newFieldName: `${name} nocopy`,
        });
        duplicatedIdByName.set(name, newFieldId);
      }

      await ctx.drainOutbox();

      const records = await ctx.listRecordsWithoutDrain(table.id);
      const row = records.find((entry) => entry.id === record.id);
      expect(row).toBeTruthy();
      if (!row) return;

      for (const name of staticNames) {
        const duplicatedId = duplicatedIdByName.get(name);
        if (!duplicatedId) throw new Error(`Missing duplicated field id for ${name}`);
        expect(row.fields[duplicatedId] ?? null, `no-copy value of ${name}`).toBeNull();
      }

      // Computed fields recompute from scratch even without copied values.
      for (const name of computedNames) {
        const duplicatedId = duplicatedIdByName.get(name);
        if (!duplicatedId) throw new Error(`Missing duplicated field id for ${name}`);
        expect(row.fields[duplicatedId] ?? null, `computed value of ${name}`).toEqual(
          row.fields[requireFieldId(name)] ?? null
        );
      }
    } finally {
      if (tableId) {
        await ctx.deleteTable(tableId).catch(() => undefined);
      }
    }
  });

  // v1 reference: field-duplicate.e2e-spec.ts
  //   - "duplicate link fields"
  //   - "should duplicate link field and preserve all cell values"
  it('[V1 PARITY] duplicates link fields as one-way copies preserving linked record values', async () => {
    let hostTableId: string | undefined;
    let foreignTableId: string | undefined;

    try {
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `DupLinkValuesForeign-${Date.now()}`,
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      });
      foreignTableId = foreignTable.id;
      const foreignPrimaryFieldId = foreignTable.fields.find((field) => field.isPrimary)?.id;
      expect(foreignPrimaryFieldId).toBeTruthy();
      if (!foreignPrimaryFieldId) return;

      const foreignRecord1 = await ctx.createRecord(foreignTable.id, {
        [foreignPrimaryFieldId]: 'Foreign 1',
      });
      const foreignRecord2 = await ctx.createRecord(foreignTable.id, {
        [foreignPrimaryFieldId]: 'Foreign 2',
      });

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `DupLinkValuesHost-${Date.now()}`,
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      hostTableId = hostTable.id;
      const hostPrimaryFieldId = hostTable.fields.find((field) => field.isPrimary)?.id;
      expect(hostPrimaryFieldId).toBeTruthy();
      if (!hostPrimaryFieldId) return;

      const linkCases = [
        { name: 'Link MM', relationship: 'manyMany', isOneWay: false, multi: true },
        { name: 'Link MO', relationship: 'manyOne', isOneWay: false, multi: false },
        { name: 'Link OM', relationship: 'oneMany', isOneWay: true, multi: true },
        { name: 'Link OO', relationship: 'oneOne', isOneWay: false, multi: false },
      ] as const;

      const linkFieldIdByName = new Map<string, string>();
      for (const linkCase of linkCases) {
        const updatedTable = await ctx.createField({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'link',
            name: linkCase.name,
            options: {
              relationship: linkCase.relationship,
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: linkCase.isOneWay,
            },
          },
        });
        const created = updatedTable.fields.find((field) => field.name === linkCase.name);
        if (!created) throw new Error(`Missing link field ${linkCase.name}`);
        linkFieldIdByName.set(linkCase.name, created.id);
      }

      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'Host 1',
        [linkFieldIdByName.get('Link MM')!]: [{ id: foreignRecord1.id }, { id: foreignRecord2.id }],
        [linkFieldIdByName.get('Link MO')!]: { id: foreignRecord1.id },
        [linkFieldIdByName.get('Link OM')!]: [{ id: foreignRecord1.id }],
        [linkFieldIdByName.get('Link OO')!]: { id: foreignRecord2.id },
      });

      await ctx.drainOutbox();

      const foreignFieldCountBefore = (await ctx.getTableById(foreignTable.id)).fields.length;

      const duplicatedIdByName = new Map<string, string>();
      for (const linkCase of linkCases) {
        const newFieldId = await duplicateField({
          tableId: hostTable.id,
          fieldId: linkFieldIdByName.get(linkCase.name)!,
          includeRecordValues: true,
          newFieldName: `${linkCase.name} copy`,
        });
        duplicatedIdByName.set(linkCase.name, newFieldId);
      }

      await ctx.drainOutbox();

      const latestHostTable = await ctx.getTableById(hostTable.id);
      for (const linkCase of linkCases) {
        const sourceField = latestHostTable.fields.find(
          (field) => field.id === linkFieldIdByName.get(linkCase.name)
        );
        const duplicatedField = latestHostTable.fields.find(
          (field) => field.id === duplicatedIdByName.get(linkCase.name)
        );
        expect(duplicatedField?.type, `type of ${linkCase.name}`).toBe('link');
        const sourceOptions = sourceField?.options as {
          foreignTableId?: string;
          relationship?: string;
        };
        const duplicatedOptions = duplicatedField?.options as {
          foreignTableId?: string;
          relationship?: string;
          isOneWay?: boolean;
          symmetricFieldId?: string;
        };
        expect(duplicatedOptions?.foreignTableId).toBe(sourceOptions?.foreignTableId);
        expect(duplicatedOptions?.relationship).toBe(sourceOptions?.relationship);
        // v1 parity: a duplicated link field is always created as one-way, no
        // extra symmetric field appears in the foreign table.
        expect(duplicatedOptions?.isOneWay, `isOneWay of ${linkCase.name} copy`).toBe(true);
        expect(duplicatedOptions?.symmetricFieldId).toBeUndefined();
      }

      const foreignFieldCountAfter = (await ctx.getTableById(foreignTable.id)).fields.length;
      expect(foreignFieldCountAfter).toBe(foreignFieldCountBefore);

      const records = await ctx.listRecordsWithoutDrain(hostTable.id);
      const row = records.find((entry) => entry.id === hostRecord.id);
      expect(row).toBeTruthy();
      if (!row) return;

      const linkedIds = (value: unknown): string[] => {
        if (value == null) return [];
        const entries = Array.isArray(value) ? value : [value];
        return entries
          .map((entry) => (entry as { id?: string }).id)
          .filter((id): id is string => typeof id === 'string')
          .sort();
      };

      for (const linkCase of linkCases) {
        const sourceValue = row.fields[linkFieldIdByName.get(linkCase.name)!];
        const duplicatedValue = row.fields[duplicatedIdByName.get(linkCase.name)!];
        expect(linkedIds(duplicatedValue), `copied linked ids of ${linkCase.name}`).toEqual(
          linkedIds(sourceValue)
        );
      }

      // includeRecordValues=false keeps the copy empty.
      const noCopyFieldId = await duplicateField({
        tableId: hostTable.id,
        fieldId: linkFieldIdByName.get('Link MM')!,
        includeRecordValues: false,
        newFieldName: 'Link MM nocopy',
      });
      await ctx.drainOutbox();
      const recordsAfterNoCopy = await ctx.listRecordsWithoutDrain(hostTable.id);
      const rowAfterNoCopy = recordsAfterNoCopy.find((entry) => entry.id === hostRecord.id);
      expect(linkedIds(rowAfterNoCopy?.fields[noCopyFieldId])).toEqual([]);
    } finally {
      if (hostTableId) {
        await ctx.deleteTable(hostTableId).catch(() => undefined);
      }
      if (foreignTableId) {
        await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    }
  });

  // v1 reference: field-duplicate.e2e-spec.ts
  //   - "duplicate rollup fields"
  //   - "duplicate lookup fields"
  it('[V1 PARITY] duplicates rollup, conditional rollup and conditional lookup preserving computed values', async () => {
    let hostTableId: string | undefined;
    let foreignTableId: string | undefined;

    try {
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `DupRollupForeign-${Date.now()}`,
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          { type: 'singleLineText', name: 'Status' },
          { type: 'number', name: 'Amount' },
        ],
      });
      foreignTableId = foreignTable.id;
      const foreignPrimaryFieldId = foreignTable.fields.find((field) => field.isPrimary)?.id;
      const foreignStatusFieldId = foreignTable.fields.find((field) => field.name === 'Status')?.id;
      const foreignAmountFieldId = foreignTable.fields.find((field) => field.name === 'Amount')?.id;
      expect(foreignPrimaryFieldId).toBeTruthy();
      expect(foreignStatusFieldId).toBeTruthy();
      expect(foreignAmountFieldId).toBeTruthy();
      if (!foreignPrimaryFieldId || !foreignStatusFieldId || !foreignAmountFieldId) return;

      const foreignRecord1 = await ctx.createRecord(foreignTable.id, {
        [foreignPrimaryFieldId]: 'Active row',
        [foreignStatusFieldId]: 'Active',
        [foreignAmountFieldId]: 10,
      });
      const foreignRecord2 = await ctx.createRecord(foreignTable.id, {
        [foreignPrimaryFieldId]: 'Inactive row',
        [foreignStatusFieldId]: 'Inactive',
        [foreignAmountFieldId]: 20,
      });

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `DupRollupHost-${Date.now()}`,
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      hostTableId = hostTable.id;
      const hostPrimaryFieldId = hostTable.fields.find((field) => field.isPrimary)?.id;
      expect(hostPrimaryFieldId).toBeTruthy();
      if (!hostPrimaryFieldId) return;

      const withLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'link',
          name: 'Foreign',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryFieldId,
          },
        },
      });
      const linkFieldId = withLink.fields.find((field) => field.name === 'Foreign')?.id;
      expect(linkFieldId).toBeTruthy();
      if (!linkFieldId) return;

      const condition = {
        filter: {
          conjunction: 'and' as const,
          filterSet: [{ fieldId: foreignStatusFieldId, operator: 'is', value: 'Active' }],
        },
      };

      const createAndGetId = async (
        field: Parameters<SharedTestContext['createField']>[0]['field'],
        name: string
      ) => {
        const updated = await ctx.createField({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field,
        });
        const created = updated.fields.find((f) => f.name === name);
        if (!created) throw new Error(`Missing created field: ${name}`);
        return created.id;
      };

      const rollupFieldId = await createAndGetId(
        {
          type: 'rollup',
          name: 'Amount Sum',
          options: { expression: 'sum({values})' },
          config: {
            linkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignAmountFieldId,
          },
        },
        'Amount Sum'
      );
      const conditionalRollupFieldId = await createAndGetId(
        {
          type: 'conditionalRollup',
          name: 'Active Amount Sum',
          options: { expression: 'sum({values})' },
          config: {
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignAmountFieldId,
            condition,
          },
        },
        'Active Amount Sum'
      );
      const conditionalLookupFieldId = await createAndGetId(
        {
          type: 'conditionalLookup',
          name: 'Active Titles',
          options: {
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryFieldId,
            condition,
          },
        },
        'Active Titles'
      );

      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'Host 1',
        [linkFieldId]: [{ id: foreignRecord1.id }, { id: foreignRecord2.id }],
      });

      await ctx.drainOutbox();

      const computedFieldIds = [rollupFieldId, conditionalRollupFieldId, conditionalLookupFieldId];
      const duplicatedIds = new Map<string, string>();
      for (const fieldId of computedFieldIds) {
        const newFieldId = await duplicateField({
          tableId: hostTable.id,
          fieldId,
          includeRecordValues: true,
          newFieldName: `copy-${fieldId}`,
        });
        duplicatedIds.set(fieldId, newFieldId);
      }

      await ctx.drainOutbox();

      const latestTable = await ctx.getTableById(hostTable.id);
      for (const fieldId of computedFieldIds) {
        const sourceField = latestTable.fields.find((field) => field.id === fieldId);
        const duplicatedField = latestTable.fields.find(
          (field) => field.id === duplicatedIds.get(fieldId)
        );
        expect(duplicatedField, `duplicated computed field ${fieldId}`).toBeTruthy();
        expect(duplicatedField?.type).toBe(sourceField?.type);
        expect(duplicatedField?.options).toEqual(sourceField?.options);
      }

      const records = await ctx.listRecordsWithoutDrain(hostTable.id);
      const row = records.find((entry) => entry.id === hostRecord.id);
      expect(row).toBeTruthy();
      if (!row) return;

      expect(row.fields[rollupFieldId]).toBe(30);
      expect(row.fields[duplicatedIds.get(rollupFieldId)!]).toBe(30);
      expect(row.fields[conditionalRollupFieldId]).toBe(10);
      expect(row.fields[duplicatedIds.get(conditionalRollupFieldId)!]).toBe(10);
      expect(row.fields[conditionalLookupFieldId]).toEqual(row.fields[conditionalLookupFieldId]);
      expect(row.fields[duplicatedIds.get(conditionalLookupFieldId)!]).toEqual(
        row.fields[conditionalLookupFieldId]
      );
    } finally {
      if (hostTableId) {
        await ctx.deleteTable(hostTableId).catch(() => undefined);
      }
      if (foreignTableId) {
        await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    }
  });
});
