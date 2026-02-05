/* eslint-disable @typescript-eslint/naming-convention */
import { updateRecordOkResponseSchema } from '@teable/v2-contract-http';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http updateRecord (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let textFieldId: string;
  let numberFieldId: string;
  let fieldIdCounter = 0;
  let typecastTableId: string;
  let typecastPrimaryFieldId: string;
  let typecastNumberFieldId: string;
  let typecastCheckboxFieldId: string;
  let typecastDateFieldId: string;
  let typecastSingleSelectFieldId: string;
  let typecastMultiSelectFieldId: string;
  let typecastRatingFieldId: string;
  let typecastSingleSelectOpenOptionId: string;
  let typecastMultiSelectTagAId: string;
  let typecastMultiSelectTagCId: string;
  let typecastSingleSelectOpenOptionName: string;
  let typecastMultiSelectTagAName: string;
  let typecastMultiSelectTagCName: string;

  const typecastCaseKeys = [
    'number',
    'checkbox',
    'date',
    'singleSelect',
    'multipleSelect',
    'rating',
  ] as const;

  type TypecastCaseKey = (typeof typecastCaseKeys)[number];

  interface TypecastCase {
    name: TypecastCaseKey;
    fieldId: () => string;
    input: unknown;
    assert: (value: unknown) => void;
  }

  const createTypecastCases = () =>
    ({
      number: {
        name: 'number',
        fieldId: () => typecastNumberFieldId,
        input: '123.5',
        assert: (value) => {
          expect(value).toBe(123.5);
        },
      },
      checkbox: {
        name: 'checkbox',
        fieldId: () => typecastCheckboxFieldId,
        input: 'true',
        assert: (value) => {
          expect(value).toBe(true);
        },
      },
      date: {
        name: 'date',
        fieldId: () => typecastDateFieldId,
        input: '2024-01-02T03:04:05.000Z',
        assert: (value) => {
          expect(value).toBe('2024-01-02T03:04:05.000Z');
        },
      },
      singleSelect: {
        name: 'singleSelect',
        fieldId: () => typecastSingleSelectFieldId,
        input: 'Open',
        assert: (value) => {
          // v2 now stores by name to align with v1 behavior
          expect(value).toBe(typecastSingleSelectOpenOptionName);
        },
      },
      multipleSelect: {
        name: 'multipleSelect',
        fieldId: () => typecastMultiSelectFieldId,
        input: ['Tag A', 'Tag C'],
        assert: (value) => {
          // v2 now stores by name to align with v1 behavior
          expect(Array.isArray(value)).toBe(true);
          expect(value).toEqual([typecastMultiSelectTagAName, typecastMultiSelectTagCName]);
        },
      },
      rating: {
        name: 'rating',
        fieldId: () => typecastRatingFieldId,
        input: '4',
        assert: (value) => {
          expect(value).toBe(4);
        },
      },
    }) satisfies Record<TypecastCaseKey, TypecastCase>;
  const typecastCaseMap = createTypecastCases();
  const _exhaustiveCheck: Record<TypecastCaseKey, TypecastCase> = typecastCaseMap;
  void _exhaustiveCheck;
  const typecastCases = Object.values(typecastCaseMap);

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const normalizeLookupArray = (value: unknown): unknown[] | undefined => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return undefined;
    if (!value.trim().startsWith('[')) return undefined;
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  };

  const expectLookupValue = (value: unknown, expected: string) => {
    const normalized = normalizeLookupArray(value);
    if (normalized) {
      expect(normalized).toContain(expected);
      return;
    }
    expect(value).toBe(expected);
  };

  const processOutbox = async (times = 1) => {
    for (let i = 0; i < times; i += 1) {
      await ctx.testContainer.processOutbox();
    }
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Update Record Table',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    const fields = table.fields;
    textFieldId = fields.find((f) => f.name === 'Title')?.id ?? '';
    numberFieldId = fields.find((f) => f.name === 'Amount')?.id ?? '';

    const typecastTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Typecast Update Table',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Number' },
        { type: 'checkbox', name: 'Checkbox' },
        { type: 'date', name: 'Date' },
        {
          type: 'singleSelect',
          name: 'Status',
          options: ['Open', 'Closed'],
        },
        {
          type: 'multipleSelect',
          name: 'Tags',
          options: ['Tag A', 'Tag B', 'Tag C'],
        },
        { type: 'rating', name: 'Score' },
      ],
      views: [{ type: 'grid' }],
    });
    typecastTableId = typecastTable.id;
    typecastPrimaryFieldId = typecastTable.fields.find((f) => f.name === 'Title')?.id ?? '';
    typecastNumberFieldId = typecastTable.fields.find((f) => f.name === 'Number')?.id ?? '';
    typecastCheckboxFieldId = typecastTable.fields.find((f) => f.name === 'Checkbox')?.id ?? '';
    typecastDateFieldId = typecastTable.fields.find((f) => f.name === 'Date')?.id ?? '';
    typecastSingleSelectFieldId = typecastTable.fields.find((f) => f.name === 'Status')?.id ?? '';
    typecastMultiSelectFieldId = typecastTable.fields.find((f) => f.name === 'Tags')?.id ?? '';
    typecastRatingFieldId = typecastTable.fields.find((f) => f.name === 'Score')?.id ?? '';

    const singleSelectField = typecastTable.fields.find((f) => f.name === 'Status');
    const singleSelectChoices =
      (singleSelectField?.options as { choices?: Array<{ id: string; name: string }> })?.choices ??
      [];
    const singleSelectOpenChoice = singleSelectChoices.find((choice) => choice.name === 'Open');
    typecastSingleSelectOpenOptionId = singleSelectOpenChoice?.id ?? '';
    typecastSingleSelectOpenOptionName = singleSelectOpenChoice?.name ?? '';
    if (!typecastSingleSelectOpenOptionId || !typecastSingleSelectOpenOptionName) {
      throw new Error('Missing single select option "Open"');
    }

    const multiSelectField = typecastTable.fields.find((f) => f.name === 'Tags');
    const multiSelectChoices =
      (multiSelectField?.options as { choices?: Array<{ id: string; name: string }> })?.choices ??
      [];
    const multiSelectTagAChoice = multiSelectChoices.find((choice) => choice.name === 'Tag A');
    const multiSelectTagCChoice = multiSelectChoices.find((choice) => choice.name === 'Tag C');
    typecastMultiSelectTagAId = multiSelectTagAChoice?.id ?? '';
    typecastMultiSelectTagCId = multiSelectTagCChoice?.id ?? '';
    typecastMultiSelectTagAName = multiSelectTagAChoice?.name ?? '';
    typecastMultiSelectTagCName = multiSelectTagCChoice?.name ?? '';
    if (
      !typecastMultiSelectTagAId ||
      !typecastMultiSelectTagCId ||
      !typecastMultiSelectTagAName ||
      !typecastMultiSelectTagCName
    ) {
      throw new Error('Missing multi select options');
    }
  });

  it('updates a record and persists changes', async () => {
    const record = await ctx.createRecord(tableId, {
      [textFieldId]: 'Original',
      [numberFieldId]: 10,
    });

    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        recordId: record.id,
        fields: {
          [textFieldId]: 'Updated',
          [numberFieldId]: 99,
        },
      }),
    });

    expect(response.status).toBe(200);

    const rawBody = await response.json();
    const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;
    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.record.id).toBe(record.id);
    expect(body.data.record.fields[textFieldId]).toBe('Updated');
    expect(body.data.record.fields[numberFieldId]).toBe(99);

    const records = await ctx.listRecords(tableId);
    const updated = records.find((r) => r.id === record.id);
    expect(updated?.fields[textFieldId]).toBe('Updated');
    expect(updated?.fields[numberFieldId]).toBe(99);
  });

  it.each(typecastCases)('updates a record with typecast $name', async (testCase) => {
    const fieldId = testCase.fieldId();
    const record = await ctx.createRecord(typecastTableId, {
      [typecastPrimaryFieldId]: `Typecast ${testCase.name}`,
    });

    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: typecastTableId,
        recordId: record.id,
        typecast: true,
        fields: {
          [fieldId]: testCase.input,
        },
      }),
    });

    expect(response.status).toBe(200);

    const rawBody = await response.json();
    const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    const value = body.data.record.fields[fieldId];
    testCase.assert(value);

    const records = await ctx.listRecords(typecastTableId);
    const updated = records.find((r) => r.id === record.id);
    expect(updated).toBeDefined();
    if (!updated) return;
    const storedValue = updated.fields[fieldId];
    if (testCase.name === 'singleSelect') {
      expect(storedValue).toBe(typecastSingleSelectOpenOptionName);
      return;
    }
    if (testCase.name === 'multipleSelect') {
      const normalized = Array.isArray(storedValue)
        ? storedValue
        : typeof storedValue === 'string'
          ? (() => {
              try {
                const parsed = JSON.parse(storedValue) as unknown;
                return Array.isArray(parsed) ? parsed : storedValue;
              } catch {
                return storedValue;
              }
            })()
          : storedValue;
      expect(normalized).toEqual([typecastMultiSelectTagAName, typecastMultiSelectTagCName]);
      return;
    }
    testCase.assert(storedValue);
  });

  it('auto creates select options when typecast is enabled', async () => {
    const record = await ctx.createRecord(typecastTableId, {
      [typecastPrimaryFieldId]: 'Auto Create Target',
    });

    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: typecastTableId,
        recordId: record.id,
        typecast: true,
        fields: {
          [typecastSingleSelectFieldId]: 'In Progress',
          [typecastMultiSelectFieldId]: ['Tag A', 'Tag Z'],
        },
      }),
    });

    expect(response.status).toBe(200);
    const rawBody = await response.json();
    const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.ok).toBe(true);
    if (!parsed.data.ok) return;

    const recordFields = parsed.data.data.record.fields;
    expect(recordFields[typecastSingleSelectFieldId]).toBe('In Progress');
    const multiValue = recordFields[typecastMultiSelectFieldId];
    const normalizedMulti = Array.isArray(multiValue)
      ? multiValue
      : typeof multiValue === 'string'
        ? (() => {
            try {
              const parsedValue = JSON.parse(multiValue) as unknown;
              return Array.isArray(parsedValue) ? parsedValue : [];
            } catch {
              return [];
            }
          })()
        : [];
    expect(normalizedMulti).toContain('Tag Z');

    const updatedTable = await ctx.getTableById(typecastTableId);
    const singleSelectField = updatedTable.fields.find(
      (field) => field.id === typecastSingleSelectFieldId
    );
    const singleChoices =
      (singleSelectField?.options as { choices?: Array<{ name: string }> })?.choices ?? [];
    expect(singleChoices.some((choice) => choice.name === 'In Progress')).toBe(true);

    const multiSelectField = updatedTable.fields.find(
      (field) => field.id === typecastMultiSelectFieldId
    );
    const multiChoices =
      (multiSelectField?.options as { choices?: Array<{ name: string }> })?.choices ?? [];
    expect(multiChoices.some((choice) => choice.name === 'Tag Z')).toBe(true);
  });

  it('updates link fields by title when typecast is enabled', async () => {
    const foreignRecordTitle = 'Foreign A';
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Typecast Link Foreign',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const foreignTitleFieldId = foreignTable.fields.find((f) => f.name === 'Name')?.id ?? '';
    if (!foreignTitleFieldId) {
      throw new Error('Missing foreign title field');
    }
    const foreignRecord = await ctx.createRecord(foreignTable.id, {
      [foreignTitleFieldId]: foreignRecordTitle,
    });

    const linkFieldId = createFieldId();
    const mainTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Typecast Link Main',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Related',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignTitleFieldId,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const mainTitleFieldId = mainTable.fields.find((f) => f.name === 'Title')?.id ?? '';
    if (!mainTitleFieldId) {
      throw new Error('Missing main title field');
    }

    const record = await ctx.createRecord(mainTable.id, {
      [mainTitleFieldId]: 'Main Row',
    });

    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: mainTable.id,
        recordId: record.id,
        typecast: true,
        fields: {
          [linkFieldId]: [foreignRecordTitle],
        },
      }),
    });

    expect(response.status).toBe(200);

    const rawBody = await response.json();
    const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    await processOutbox();

    const records = await ctx.listRecords(mainTable.id);
    const updated = records.find((r) => r.id === record.id);
    expect(updated).toBeDefined();
    if (!updated) return;

    const linkValue = updated.fields[linkFieldId] as unknown;
    expect(Array.isArray(linkValue)).toBe(true);
    const linkArray = linkValue as Array<{ id: string; title?: string }>;
    expect(linkArray.some((link) => link.id === foreignRecord.id)).toBe(true);
  });

  it('updates formula chains in a real-world table', async () => {
    const amountFieldId = createFieldId();
    const scoreFieldId = createFieldId();
    const scoreLabelFieldId = createFieldId();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Realworld Formula Chain',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', id: amountFieldId, name: 'Amount' },
        {
          type: 'formula',
          id: scoreFieldId,
          name: 'Score',
          options: { expression: `{${amountFieldId}} * 2` },
        },
        {
          type: 'formula',
          id: scoreLabelFieldId,
          name: 'Score Label',
          options: { expression: `CONCATENATE("Score: ", {${scoreFieldId}})` },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const nameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!nameFieldId) throw new Error('Missing primary field for formula chain table');

    const record = await ctx.createRecord(table.id, {
      [nameFieldId]: 'Alpha',
      [amountFieldId]: 5,
    });

    await ctx.updateRecord(table.id, record.id, {
      [amountFieldId]: 7,
    });

    await processOutbox();

    const records = await ctx.listRecords(table.id);
    const updated = records.find((r) => r.id === record.id);
    expect(updated?.fields[scoreFieldId]).toBe(14);
    expect(updated?.fields[scoreLabelFieldId]).toBe('Score: 14');
  });

  it('updates lookup values when source formulas change', async () => {
    const scoreFieldId = createFieldId();
    const scoreLabelFieldId = createFieldId();

    const contacts = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Contacts',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', id: scoreFieldId, name: 'Score' },
        {
          type: 'formula',
          id: scoreLabelFieldId,
          name: 'Score Label',
          options: { expression: `CONCATENATE("Score: ", {${scoreFieldId}})` },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const contactNameFieldId = contacts.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!contactNameFieldId) throw new Error('Missing primary field for contacts table');

    const contact = await ctx.createRecord(contacts.id, {
      [contactNameFieldId]: 'Alice',
      [scoreFieldId]: 2,
    });

    const linkFieldId = createFieldId();
    const lookupFieldId = createFieldId();

    const deals = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Deals',
      fields: [
        { type: 'singleLineText', name: 'Deal', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Contact',
          options: {
            relationship: 'manyOne',
            foreignTableId: contacts.id,
            lookupFieldId: contactNameFieldId,
          },
        },
        {
          type: 'lookup',
          id: lookupFieldId,
          name: 'Contact Score Label',
          options: {
            linkFieldId,
            foreignTableId: contacts.id,
            lookupFieldId: scoreLabelFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const dealNameFieldId = deals.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!dealNameFieldId) throw new Error('Missing primary field for deals table');

    const deal = await ctx.createRecord(deals.id, {
      [dealNameFieldId]: 'Deal A',
      [linkFieldId]: { id: contact.id },
    });
    await processOutbox();

    let records = await ctx.listRecords(deals.id);
    let stored = records.find((r) => r.id === deal.id);
    expectLookupValue(stored?.fields[lookupFieldId], 'Score: 2');

    await ctx.updateRecord(contacts.id, contact.id, {
      [scoreFieldId]: 8,
    });
    await processOutbox();

    records = await ctx.listRecords(deals.id);
    stored = records.find((r) => r.id === deal.id);
    expectLookupValue(stored?.fields[lookupFieldId], 'Score: 8');
  });

  it('updates rollups and link titles when linked records change', async () => {
    const hoursFieldId = createFieldId();

    const tasks = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Tasks',
      fields: [
        { type: 'singleLineText', name: 'Task', isPrimary: true },
        { type: 'number', id: hoursFieldId, name: 'Hours' },
      ],
      views: [{ type: 'grid' }],
    });

    const taskNameFieldId = tasks.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!taskNameFieldId) throw new Error('Missing primary field for tasks table');

    const taskA = await ctx.createRecord(tasks.id, {
      [taskNameFieldId]: 'Design',
      [hoursFieldId]: 2,
    });
    const taskB = await ctx.createRecord(tasks.id, {
      [taskNameFieldId]: 'Build',
      [hoursFieldId]: 3,
    });

    const linkFieldId = createFieldId();
    const rollupFieldId = createFieldId();

    const projects = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Projects',
      fields: [
        { type: 'singleLineText', name: 'Project', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Tasks',
          options: {
            relationship: 'manyMany',
            foreignTableId: tasks.id,
            lookupFieldId: taskNameFieldId,
            isOneWay: true,
          },
        },
        {
          type: 'rollup',
          id: rollupFieldId,
          name: 'Total Hours',
          options: { expression: 'sum({values})' },
          config: {
            linkFieldId,
            foreignTableId: tasks.id,
            lookupFieldId: hoursFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const projectNameFieldId = projects.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!projectNameFieldId) throw new Error('Missing primary field for projects table');

    const project = await ctx.createRecord(projects.id, {
      [projectNameFieldId]: 'Launch',
      [linkFieldId]: [{ id: taskA.id }, { id: taskB.id }],
    });
    await processOutbox();

    let records = await ctx.listRecords(projects.id);
    let stored = records.find((r) => r.id === project.id);
    expect(stored?.fields[rollupFieldId]).toBe(5);
    const beforeLinks = stored?.fields[linkFieldId] as Array<{ id: string; title?: string }>;
    expect(beforeLinks?.map((link) => link.title)).toEqual(
      expect.arrayContaining(['Design', 'Build'])
    );

    await ctx.updateRecord(tasks.id, taskB.id, {
      [taskNameFieldId]: 'Build v2',
      [hoursFieldId]: 5,
    });
    await processOutbox();

    records = await ctx.listRecords(projects.id);
    stored = records.find((r) => r.id === project.id);
    expect(stored?.fields[rollupFieldId]).toBe(7);
    const updatedLinks = stored?.fields[linkFieldId] as Array<{ id: string; title?: string }>;
    expect(updatedLinks?.map((link) => link.title)).toEqual(
      expect.arrayContaining(['Design', 'Build v2'])
    );

    await ctx.updateRecord(projects.id, project.id, {
      [linkFieldId]: [{ id: taskB.id }],
    });
    await processOutbox();

    records = await ctx.listRecords(projects.id);
    stored = records.find((r) => r.id === project.id);
    expect(stored?.fields[rollupFieldId]).toBe(5);
    const finalLinks = stored?.fields[linkFieldId] as Array<{ id: string; title?: string }>;
    expect(finalLinks?.some((link) => link.id === taskA.id)).toBe(false);
    expect(finalLinks?.some((link) => link.id === taskB.id)).toBe(true);
  });

  it('cascades lookup values across multiple tables', async () => {
    const contactScoreFieldId = createFieldId();
    const contactScoreLabelId = createFieldId();
    const contactScoreLookupId = createFieldId();

    const contacts = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Cascade Contacts',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', id: contactScoreFieldId, name: 'Score' },
        {
          type: 'formula',
          id: contactScoreLabelId,
          name: 'Score Label',
          options: { expression: `CONCATENATE("Score: ", {${contactScoreFieldId}})` },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const contactNameFieldId = contacts.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!contactNameFieldId) throw new Error('Missing primary field for contacts table');

    const linkToContactId = createFieldId();

    const deals = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Cascade Deals',
      fields: [
        { type: 'singleLineText', name: 'Deal', isPrimary: true },
        {
          type: 'link',
          id: linkToContactId,
          name: 'Contact',
          options: {
            relationship: 'manyOne',
            foreignTableId: contacts.id,
            lookupFieldId: contactNameFieldId,
          },
        },
        {
          type: 'lookup',
          id: contactScoreLookupId,
          name: 'Contact Score',
          options: {
            linkFieldId: linkToContactId,
            foreignTableId: contacts.id,
            lookupFieldId: contactScoreLabelId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const dealNameFieldId = deals.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!dealNameFieldId) throw new Error('Missing primary field for deals table');

    const accountDealLinkId = createFieldId();
    const accountDealScoreLabelId = createFieldId();

    const accounts = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Cascade Accounts',
      fields: [
        { type: 'singleLineText', name: 'Account', isPrimary: true },
        {
          type: 'link',
          id: accountDealLinkId,
          name: 'Deal',
          options: {
            relationship: 'manyOne',
            foreignTableId: deals.id,
            lookupFieldId: dealNameFieldId,
          },
        },
        {
          type: 'lookup',
          id: accountDealScoreLabelId,
          name: 'Deal Score Label',
          options: {
            linkFieldId: accountDealLinkId,
            foreignTableId: deals.id,
            lookupFieldId: contactScoreLookupId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const accountNameFieldId = accounts.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!accountNameFieldId) throw new Error('Missing primary field for accounts table');

    const contact = await ctx.createRecord(contacts.id, {
      [contactNameFieldId]: 'Sam',
      [contactScoreFieldId]: 2,
    });

    const deal = await ctx.createRecord(deals.id, {
      [dealNameFieldId]: 'Deal X',
      [linkToContactId]: { id: contact.id },
    });

    const account = await ctx.createRecord(accounts.id, {
      [accountNameFieldId]: 'Account 1',
      [accountDealLinkId]: { id: deal.id },
    });
    await processOutbox(2);

    let accountsRecords = await ctx.listRecords(accounts.id);
    let stored = accountsRecords.find((r) => r.id === account.id);
    expectLookupValue(stored?.fields[accountDealScoreLabelId], 'Score: 2');

    await ctx.updateRecord(contacts.id, contact.id, {
      [contactScoreFieldId]: 5,
    });
    await processOutbox(2);

    accountsRecords = await ctx.listRecords(accounts.id);
    stored = accountsRecords.find((r) => r.id === account.id);
    expectLookupValue(stored?.fields[accountDealScoreLabelId], 'Score: 5');
  });

  it('updates lookup values when link relations change', async () => {
    const levelFieldId = createFieldId();

    const people = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'People',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', id: levelFieldId, name: 'Level' },
      ],
      views: [{ type: 'grid' }],
    });

    const peopleNameFieldId = people.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!peopleNameFieldId) throw new Error('Missing primary field for people table');

    const linkFieldId = createFieldId();
    const lookupFieldId = createFieldId();

    const teams = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Teams',
      fields: [
        { type: 'singleLineText', name: 'Team', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Members',
          options: {
            relationship: 'manyMany',
            foreignTableId: people.id,
            lookupFieldId: peopleNameFieldId,
          },
        },
        {
          type: 'lookup',
          id: lookupFieldId,
          name: 'Member Levels',
          options: {
            linkFieldId,
            foreignTableId: people.id,
            lookupFieldId: levelFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const teamNameFieldId = teams.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!teamNameFieldId) throw new Error('Missing primary field for teams table');

    const alice = await ctx.createRecord(people.id, {
      [peopleNameFieldId]: 'Alice',
      [levelFieldId]: 1,
    });
    const bob = await ctx.createRecord(people.id, {
      [peopleNameFieldId]: 'Bob',
      [levelFieldId]: 2,
    });

    const team = await ctx.createRecord(teams.id, {
      [teamNameFieldId]: 'Alpha',
      [linkFieldId]: [{ id: alice.id }],
    });
    await processOutbox();

    let teamRecords = await ctx.listRecords(teams.id);
    let stored = teamRecords.find((r) => r.id === team.id);
    const initialLevels = normalizeLookupArray(stored?.fields[lookupFieldId]) as
      | number[]
      | undefined;
    expect(initialLevels?.sort()).toEqual([1]);

    await ctx.updateRecord(teams.id, team.id, {
      [linkFieldId]: [{ id: alice.id }, { id: bob.id }],
    });
    await processOutbox();

    teamRecords = await ctx.listRecords(teams.id);
    stored = teamRecords.find((r) => r.id === team.id);
    const bothLevels = normalizeLookupArray(stored?.fields[lookupFieldId]) as number[] | undefined;
    expect(bothLevels?.sort()).toEqual([1, 2]);

    await ctx.updateRecord(teams.id, team.id, {
      [linkFieldId]: [{ id: bob.id }],
    });
    await processOutbox();

    teamRecords = await ctx.listRecords(teams.id);
    stored = teamRecords.find((r) => r.id === team.id);
    const finalLevels = normalizeLookupArray(stored?.fields[lookupFieldId]) as number[] | undefined;
    expect(finalLevels?.sort()).toEqual([2]);
  });

  it('clears link when primary formula embeds lookup value', async () => {
    const codeFieldId = createFieldId();

    const companies = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Companies With Codes',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', id: codeFieldId, name: 'Code' },
      ],
      views: [{ type: 'grid' }],
    });

    const companyNameFieldId = companies.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!companyNameFieldId) throw new Error('Missing primary field for companies table');

    const company = await ctx.createRecord(companies.id, {
      [companyNameFieldId]: 'Acme',
      [codeFieldId]: 'AC-01',
    });

    const linkFieldId = createFieldId();
    const lookupFieldId = createFieldId();
    const primaryFormulaFieldId = createFieldId();

    const deals = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Deals With Primary Formula',
      fields: [
        {
          type: 'formula',
          id: primaryFormulaFieldId,
          name: 'Display',
          isPrimary: true,
          options: {
            expression: `{${lookupFieldId}}`,
          },
        },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Company',
          options: {
            relationship: 'manyOne',
            foreignTableId: companies.id,
            lookupFieldId: companyNameFieldId,
          },
        },
        {
          type: 'lookup',
          id: lookupFieldId,
          name: 'Company Code',
          options: {
            linkFieldId,
            foreignTableId: companies.id,
            lookupFieldId: codeFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const deal = await ctx.createRecord(deals.id, {
      [linkFieldId]: { id: company.id },
    });
    await processOutbox(2);

    let dealRecords = await ctx.listRecords(deals.id);
    let stored = dealRecords.find((r) => r.id === deal.id);
    expectLookupValue(stored?.fields[lookupFieldId], 'AC-01');
    expectLookupValue(stored?.fields[primaryFormulaFieldId], 'AC-01');

    await ctx.updateRecord(deals.id, deal.id, {
      [linkFieldId]: null,
    });
    await processOutbox(2);

    dealRecords = await ctx.listRecords(deals.id);
    stored = dealRecords.find((r) => r.id === deal.id);
    expect(stored?.fields[linkFieldId] ?? undefined).toBeUndefined();
    expect(stored?.fields[lookupFieldId] ?? undefined).toBeUndefined();
    expect(stored?.fields[primaryFormulaFieldId] ?? undefined).toBeUndefined();
  });

  it('updates symmetric link values when relations change', async () => {
    const tasks = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Tasks B',
      fields: [{ type: 'singleLineText', name: 'Task', isPrimary: true }],
      views: [{ type: 'grid' }],
    });

    const taskNameFieldId = tasks.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!taskNameFieldId) {
      throw new Error('Missing primary field for symmetric link test');
    }

    const projectTaskLinkId = createFieldId();

    const projects = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Projects With Link',
      fields: [
        { type: 'singleLineText', name: 'Project', isPrimary: true },
        {
          type: 'link',
          id: projectTaskLinkId,
          name: 'Tasks',
          options: {
            relationship: 'manyMany',
            foreignTableId: tasks.id,
            lookupFieldId: taskNameFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const projectNameFieldId = projects.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!projectNameFieldId) {
      throw new Error('Missing project primary field for symmetric link test');
    }

    const projectLinkField = projects.fields.find((f) => f.id === projectTaskLinkId);
    if (!projectLinkField || projectLinkField.type !== 'link') {
      throw new Error('Missing project link field');
    }
    const symmetricFieldId = projectLinkField.options.symmetricFieldId ?? '';
    if (!symmetricFieldId) throw new Error('Missing symmetric link field id');

    const task = await ctx.createRecord(tasks.id, {
      [taskNameFieldId]: 'Task 1',
    });

    const project = await ctx.createRecord(projects.id, {
      [projectNameFieldId]: 'Project 1',
      [projectTaskLinkId]: [{ id: task.id }],
    });
    await processOutbox(2);

    let taskRecords = await ctx.listRecords(tasks.id);
    let taskRow = taskRecords.find((r) => r.id === task.id);
    const symmetricLinks = normalizeLookupArray(taskRow?.fields[symmetricFieldId]) as
      | Array<{ id: string }>
      | undefined;
    expect(symmetricLinks?.some((link) => link.id === project.id)).toBe(true);

    await ctx.updateRecord(projects.id, project.id, {
      [projectTaskLinkId]: [],
    });
    await processOutbox(2);

    taskRecords = await ctx.listRecords(tasks.id);
    taskRow = taskRecords.find((r) => r.id === task.id);
    const updatedLinks = normalizeLookupArray(taskRow?.fields[symmetricFieldId]) as
      | Array<{ id: string }>
      | undefined;
    expect((updatedLinks ?? []).some((link) => link.id === project.id)).toBe(false);
  });
});
