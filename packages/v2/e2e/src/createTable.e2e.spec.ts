/* eslint-disable @typescript-eslint/naming-convention */
import { createTableOkResponseSchema } from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import type { ICreateTableCommandInput } from '@teable/v2-core';
import { createAllFieldTypesFields, tableTemplates } from '@teable/v2-table-templates';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http createTable (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const buildPayload = (name: string) => {
    const amountFieldId = createFieldId();
    const scoreFieldId = createFieldId();
    return {
      baseId: ctx.baseId,
      name,
      fields: [
        { type: 'singleLineText', name: 'Name' },
        { type: 'number', id: amountFieldId, name: 'Amount' },
        {
          type: 'formula',
          id: scoreFieldId,
          name: 'Score',
          options: { expression: `{${amountFieldId}} * 2` },
        },
        { type: 'rating', name: 'Priority', max: 5 },
        { type: 'singleSelect', name: 'Status', options: ['Todo', 'Doing', 'Done'] },
      ],
    } as ICreateTableCommandInput;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('returns 201 ok and includes TableCreated (fetch)', async () => {
    const payload = buildPayload('Projects');

    const response = await fetch(`${ctx.baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(201);

    const rawBody = await response.json();
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.name).toBe('Projects');
    expect(body.data.table.baseId).toBe(ctx.baseId);
    expect(body.data.table.fields).toHaveLength(5);
    expect(body.data.table.fields.filter((f) => f.isPrimary).length).toBe(1);
    expect(body.data.table.views.length).toBeGreaterThan(0);
    expect(body.data.events.some((e) => e.name === 'TableCreated')).toBe(true);
  });

  it('returns ok response via orpc client', async () => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    const body = await client.tables.create({
      ...buildPayload('Projects (client)'),
    });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.name).toBe('Projects (client)');
    expect(body.data.table.baseId).toBe(ctx.baseId);
    expect(body.data.table.fields).toHaveLength(5);
    expect(body.data.table.fields.filter((f) => f.isPrimary).length).toBe(1);
    expect(body.data.table.views.length).toBeGreaterThan(0);
    expect(body.data.events.some((e) => e.name === 'TableCreated')).toBe(true);
  });

  it('creates records when included in the payload', async () => {
    const nameFieldId = createFieldId();
    const payload: ICreateTableCommandInput = {
      baseId: ctx.baseId,
      name: 'Seeded',
      fields: [{ type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true }],
      records: [{ fields: { [nameFieldId]: 'Alpha' } }, { fields: { [nameFieldId]: 'Beta' } }],
    };

    const created = await ctx.createTable(payload);
    const records = await ctx.listRecords(created.id, { limit: 1000 });

    expect(records).toHaveLength(2);
    const values = records.map((record) => record.fields[nameFieldId]);
    expect(values).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
  });

  it('persists field descriptions in createTable payload', async () => {
    const nameFieldId = createFieldId();
    const amountFieldId = createFieldId();
    const payload: ICreateTableCommandInput = {
      baseId: ctx.baseId,
      name: 'Field Description Table',
      fields: [
        {
          type: 'singleLineText',
          id: nameFieldId,
          name: 'Name',
          description: 'primary description',
          isPrimary: true,
        },
        {
          type: 'number',
          id: amountFieldId,
          name: 'Amount',
          description: 'amount description',
        },
      ],
    };

    const created = await ctx.createTable(payload);
    const nameField = created.fields.find((field) => field.id === nameFieldId);
    const amountField = created.fields.find((field) => field.id === amountFieldId);
    expect(nameField?.description).toBe('primary description');
    expect(amountField?.description).toBe('amount description');

    const fetched = await ctx.getTableById(created.id);
    const fetchedNameField = fetched.fields.find((field) => field.id === nameFieldId);
    const fetchedAmountField = fetched.fields.find((field) => field.id === amountFieldId);
    expect(fetchedNameField?.description).toBe('primary description');
    expect(fetchedAmountField?.description).toBe('amount description');
  });

  it('creates a table with all field types in a single create request', async () => {
    const companyNameFieldId = createFieldId();
    const companyRevenueFieldId = createFieldId();
    const companyLinkFieldId = createFieldId();
    const companyLookupFieldId = createFieldId();
    const companyRollupFieldId = createFieldId();
    const conditionalLookupFieldId = createFieldId();
    const conditionalRollupFieldId = createFieldId();
    const autoNumberFieldId = createFieldId();
    const createdTimeFieldId = createFieldId();
    const lastModifiedTimeFieldId = createFieldId();
    const createdByFieldId = createFieldId();
    const lastModifiedByFieldId = createFieldId();

    const companies = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'All Field Types Companies',
      fields: [
        { type: 'singleLineText', id: companyNameFieldId, name: 'Name', isPrimary: true },
        { type: 'number', id: companyRevenueFieldId, name: 'Revenue' },
      ],
      records: [{ fields: { [companyNameFieldId]: 'Acme Inc.', [companyRevenueFieldId]: 120 } }],
    });

    const companyRecord = (await ctx.listRecords(companies.id, { limit: 10 })).at(0);
    expect(companyRecord).toBeDefined();
    if (!companyRecord) return;

    const payload: ICreateTableCommandInput = {
      baseId: ctx.baseId,
      name: 'Create Table All Types',
      fields: [
        ...createAllFieldTypesFields(),
        { type: 'autoNumber', id: autoNumberFieldId, name: 'Auto Number' },
        { type: 'createdTime', id: createdTimeFieldId, name: 'Created Time' },
        { type: 'lastModifiedTime', id: lastModifiedTimeFieldId, name: 'Last Modified Time' },
        { type: 'createdBy', id: createdByFieldId, name: 'Created By' },
        { type: 'lastModifiedBy', id: lastModifiedByFieldId, name: 'Last Modified By' },
        {
          type: 'link',
          id: companyLinkFieldId,
          name: 'Company',
          options: {
            relationship: 'manyOne',
            foreignTableId: companies.id,
            lookupFieldId: companyNameFieldId,
          },
        },
        {
          type: 'lookup',
          id: companyLookupFieldId,
          name: 'Company Name',
          options: {
            linkFieldId: companyLinkFieldId,
            foreignTableId: companies.id,
            lookupFieldId: companyNameFieldId,
          },
        },
        {
          type: 'rollup',
          id: companyRollupFieldId,
          name: 'Company Revenue Total',
          options: { expression: 'sum({values})' },
          config: {
            linkFieldId: companyLinkFieldId,
            foreignTableId: companies.id,
            lookupFieldId: companyRevenueFieldId,
          },
        },
        {
          type: 'conditionalLookup',
          id: conditionalLookupFieldId,
          name: 'High Revenue Companies',
          options: {
            foreignTableId: companies.id,
            lookupFieldId: companyNameFieldId,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: companyRevenueFieldId,
                    operator: 'isGreater',
                    value: 100,
                  },
                ],
              },
            },
          },
        },
        {
          type: 'conditionalRollup',
          id: conditionalRollupFieldId,
          name: 'High Revenue Total',
          options: { expression: 'sum({values})' },
          config: {
            foreignTableId: companies.id,
            lookupFieldId: companyRevenueFieldId,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: companyRevenueFieldId,
                    operator: 'isGreater',
                    value: 100,
                  },
                ],
              },
            },
          },
        },
      ],
    };

    const created = await ctx.createTable(payload);
    const fieldByName = new Map(created.fields.map((field) => [field.name, field]));

    expect(fieldByName.get('Name')?.type).toBe('singleLineText');
    expect(fieldByName.get('Description')?.type).toBe('longText');
    expect(fieldByName.get('Amount')?.type).toBe('number');
    expect(fieldByName.get('Score')?.type).toBe('formula');
    expect(fieldByName.get('Priority')?.type).toBe('rating');
    expect(fieldByName.get('Status')?.type).toBe('singleSelect');
    expect(fieldByName.get('Tags')?.type).toBe('multipleSelect');
    expect(fieldByName.get('Done')?.type).toBe('checkbox');
    expect(fieldByName.get('Files')?.type).toBe('attachment');
    expect(fieldByName.get('Due Date')?.type).toBe('date');
    expect(fieldByName.get('Auto Number')?.type).toBe('autoNumber');
    expect(fieldByName.get('Created Time')?.type).toBe('createdTime');
    expect(fieldByName.get('Last Modified Time')?.type).toBe('lastModifiedTime');
    expect(fieldByName.get('Created By')?.type).toBe('createdBy');
    expect(fieldByName.get('Last Modified By')?.type).toBe('lastModifiedBy');
    expect(fieldByName.get('Owner')?.type).toBe('user');
    expect(fieldByName.get('Action')?.type).toBe('button');
    expect(fieldByName.get('Company')?.type).toBe('link');
    expect(fieldByName.get('Company Name')?.type).toBe('singleLineText');
    expect(fieldByName.get('Company Name')?.isLookup).toBe(true);
    expect(fieldByName.get('Company Revenue Total')?.type).toBe('rollup');
    expect(fieldByName.get('High Revenue Companies')?.type).toBe('singleLineText');
    expect(fieldByName.get('High Revenue Companies')?.isLookup).toBe(true);
    expect(fieldByName.get('High Revenue Companies')?.conditionalLookupOptions).toBeTruthy();
    expect(fieldByName.get('High Revenue Total')?.type).toBe('conditionalRollup');

    const statusField = fieldByName.get('Status');
    const tagField = fieldByName.get('Tags');
    const companyField = fieldByName.get('Company');
    expect(statusField).toBeDefined();
    expect(tagField).toBeDefined();
    expect(companyField).toBeDefined();
    if (!statusField || !tagField || !companyField) return;

    const statusChoices =
      statusField.options &&
      typeof statusField.options === 'object' &&
      'choices' in statusField.options
        ? (statusField.options as { choices?: Array<{ id?: string; name: string }> }).choices ?? []
        : [];
    const tagChoices =
      tagField.options && typeof tagField.options === 'object' && 'choices' in tagField.options
        ? (tagField.options as { choices?: Array<{ id?: string; name: string }> }).choices ?? []
        : [];

    await ctx.createRecord(created.id, {
      Name: 'owner@example.com',
      Description: 'Created with all field types',
      Amount: 10,
      Priority: 4,
      Status: statusChoices.find((choice) => choice.name === 'Todo')?.id,
      Tags: tagChoices
        .filter((choice) => choice.name === 'Frontend' || choice.name === 'Bug')
        .map((choice) => choice.id)
        .filter((id): id is string => Boolean(id)),
      Done: true,
      Files: [],
      'Due Date': '2025-02-10T00:00:00.000Z',
      Company: { id: companyRecord.id },
    });
    await ctx.drainOutbox();

    const records = await ctx.listRecords(created.id, { limit: 10 });
    const createdRecord = records.at(0);
    expect(createdRecord).toBeDefined();
    if (!createdRecord) return;

    expect(createdRecord.fields[companyLookupFieldId]).toEqual(
      expect.arrayContaining(['Acme Inc.'])
    );
    expect(Number(createdRecord.fields[companyRollupFieldId])).toBe(120);
    expect(createdRecord.fields[conditionalLookupFieldId]).toEqual(
      expect.arrayContaining(['Acme Inc.'])
    );
    expect(Number(createdRecord.fields[conditionalRollupFieldId])).toBe(120);
    expect(typeof createdRecord.fields[autoNumberFieldId]).toBe('number');
    expect(typeof createdRecord.fields[createdTimeFieldId]).toBe('string');
    expect(typeof createdRecord.fields[lastModifiedTimeFieldId]).toBe('string');
    expect(createdRecord.fields[createdByFieldId]).toMatchObject({
      id: ctx.testUser.id,
      title: ctx.testUser.name,
      email: ctx.testUser.email,
    });
    expect(createdRecord.fields[lastModifiedByFieldId]).toMatchObject({
      id: ctx.testUser.id,
      title: ctx.testUser.name,
      email: ctx.testUser.email,
    });
  });

  it('allows creating two tables with the same name', async () => {
    const first = await ctx.createTable(buildPayload('Same Name'));
    const second = await ctx.createTable(buildPayload('Same Name'));

    expect(first.name).toBe('Same Name');
    expect(second.name).toBe('Same Name');
    expect(first.id).not.toBe(second.id);
    expect(first.baseId).toBe(ctx.baseId);
    expect(second.baseId).toBe(ctx.baseId);
  });

  it('creates tables for every template with seeded records', async () => {
    let index = 0;
    for (const template of tableTemplates) {
      const name = `Template ${template.key} ${index + 1}`;
      const created = await ctx.createTables(
        template.createInput(ctx.baseId, { namePrefix: name, includeRecords: true })
      );

      if (template.key === 'bug-triage') {
        await ctx.testContainer.processOutbox();
      }

      expect(created.length).toBe(template.tables.length);
      for (let tableIndex = 0; tableIndex < created.length; tableIndex += 1) {
        const table = created[tableIndex]!;
        const templateTable = template.tables[tableIndex]!;
        const expectedName = template.tables.length > 1 ? `${name} - ${templateTable.name}` : name;

        expect(table.name).toBe(expectedName);
        expect(table.baseId).toBe(ctx.baseId);
        expect(table.fields.length).toBeGreaterThan(0);

        const records = await ctx.listRecords(table.id, { limit: 1000 });
        expect(records).toHaveLength(templateTable.defaultRecordCount);
        if (templateTable.defaultRecordCount > 0) {
          expect(Object.keys(records[0]!.fields)).not.toHaveLength(0);
        }

        if (template.key === 'bug-triage' && templateTable.key === 'bugs') {
          const uiComponentsField = table.fields.find((f) => f.name === 'UI Components');
          const uiComponentCountField = table.fields.find((f) => f.name === 'UI Component Count');
          expect(uiComponentsField).toBeTruthy();
          expect(uiComponentCountField).toBeTruthy();
          if (!uiComponentsField || !uiComponentCountField) return;

          const first = records[0]!;
          const uiValue = first.fields[uiComponentsField.id];
          const countValue = first.fields[uiComponentCountField.id];

          const uiComponents = (() => {
            if (Array.isArray(uiValue)) {
              return uiValue.filter((value): value is string => typeof value === 'string');
            }
            if (typeof uiValue === 'string') {
              try {
                const parsed: unknown = JSON.parse(uiValue);
                if (Array.isArray(parsed)) {
                  return parsed.filter((value): value is string => typeof value === 'string');
                }
              } catch {
                // fall back to treating the raw string as a single value
              }
              return [uiValue];
            }
            return [];
          })();

          expect(uiComponents).toContain('UI');
          expect(Number(countValue)).toBe(1);
        }
      }
      index += 1;
    }
  });

  it('keeps seeded records aligned with input table order', async () => {
    const tableAId = `tbl${'a'.repeat(16)}`;
    const tableBId = `tbl${'b'.repeat(16)}`;
    const tableAPrimaryId = createFieldId();
    const tableBPrimaryId = createFieldId();
    const tableALinkId = createFieldId();

    const tables = await ctx.createTables({
      baseId: ctx.baseId,
      tables: [
        {
          tableId: tableAId,
          name: 'Order A',
          fields: [
            { type: 'singleLineText', id: tableAPrimaryId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: tableALinkId,
              name: 'Link to B',
              options: {
                relationship: 'manyMany',
                foreignTableId: tableBId,
                lookupFieldId: tableBPrimaryId,
              },
            },
          ],
          views: [{ type: 'grid' }],
          records: [{ fields: { [tableAPrimaryId]: 'A1' } }],
        },
        {
          tableId: tableBId,
          name: 'Order B',
          fields: [{ type: 'singleLineText', id: tableBPrimaryId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
          records: [{ fields: { [tableBPrimaryId]: 'B1' } }],
        },
      ],
    });

    expect(tables.map((table) => table.id)).toEqual([tableAId, tableBId]);

    const recordsA = await ctx.listRecords(tableAId, { limit: 1000 });
    const recordsB = await ctx.listRecords(tableBId, { limit: 1000 });

    expect(recordsA).toHaveLength(1);
    expect(recordsB).toHaveLength(1);
    expect(recordsA[0]?.fields[tableAPrimaryId]).toBe('A1');
    expect(recordsB[0]?.fields[tableBPrimaryId]).toBe('B1');
  });

  it('persists field descriptions in createTables payload', async () => {
    const tableAId = `tbl${'p'.repeat(16)}`;
    const tableBId = `tbl${'q'.repeat(16)}`;
    const tableANameFieldId = createFieldId();
    const tableANumberFieldId = createFieldId();
    const tableBNameFieldId = createFieldId();

    const tables = await ctx.createTables({
      baseId: ctx.baseId,
      tables: [
        {
          tableId: tableAId,
          name: 'Description Table A',
          fields: [
            {
              type: 'singleLineText',
              id: tableANameFieldId,
              name: 'Name',
              description: 'table-a primary description',
              isPrimary: true,
            },
            {
              type: 'number',
              id: tableANumberFieldId,
              name: 'Amount',
              description: 'table-a amount description',
            },
          ],
        },
        {
          tableId: tableBId,
          name: 'Description Table B',
          fields: [
            {
              type: 'singleLineText',
              id: tableBNameFieldId,
              name: 'Name',
              description: 'table-b primary description',
              isPrimary: true,
            },
          ],
        },
      ],
    });

    const tableA = tables.find((table) => table.id === tableAId);
    const tableB = tables.find((table) => table.id === tableBId);
    expect(tableA).toBeDefined();
    expect(tableB).toBeDefined();

    const tableANameField = tableA?.fields.find((field) => field.id === tableANameFieldId);
    const tableANumberField = tableA?.fields.find((field) => field.id === tableANumberFieldId);
    const tableBNameField = tableB?.fields.find((field) => field.id === tableBNameFieldId);
    expect(tableANameField?.description).toBe('table-a primary description');
    expect(tableANumberField?.description).toBe('table-a amount description');
    expect(tableBNameField?.description).toBe('table-b primary description');

    const fetchedTableA = await ctx.getTableById(tableAId);
    const fetchedTableB = await ctx.getTableById(tableBId);
    expect(fetchedTableA.fields.find((field) => field.id === tableANameFieldId)?.description).toBe(
      'table-a primary description'
    );
    expect(
      fetchedTableA.fields.find((field) => field.id === tableANumberFieldId)?.description
    ).toBe('table-a amount description');
    expect(fetchedTableB.fields.find((field) => field.id === tableBNameFieldId)?.description).toBe(
      'table-b primary description'
    );
  });

  it('creates tables when rollup and formula fields are declared before dependencies', async () => {
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Companies',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });

    const foreignPrimaryField = foreignTable.fields.find((field) => field.isPrimary);
    expect(foreignPrimaryField).toBeDefined();
    if (!foreignPrimaryField) return;

    const linkFieldId = createFieldId();
    const amountFieldId = createFieldId();

    const payload: ICreateTableCommandInput = {
      baseId: ctx.baseId,
      name: 'Out Of Order',
      fields: [
        {
          type: 'rollup',
          name: 'Rollup Total',
          options: { expression: 'counta({values})' },
          config: {
            linkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryField.id,
          },
        },
        {
          type: 'formula',
          name: 'Score',
          options: { expression: `{${amountFieldId}} + 1` },
        },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Company',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryField.id,
          },
        },
        { type: 'number', id: amountFieldId, name: 'Amount' },
        { type: 'singleLineText', name: 'Name', isPrimary: true },
      ],
    };

    const created = await ctx.createTable(payload);
    const types = created.fields.map((field) => field.type);
    expect(types).toContain('rollup');
    expect(types).toContain('formula');
    expect(types).toContain('link');
  });

  describe('link fields', () => {
    it('creates symmetric link fields for all relationships', async () => {
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Companies',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });

      const foreignPrimaryField = foreignTable.fields.find((f) => f.isPrimary);
      expect(foreignPrimaryField).toBeDefined();
      if (!foreignPrimaryField) return;

      const cases = [
        { relationship: 'oneOne', expected: 'oneOne' },
        { relationship: 'manyMany', expected: 'manyMany' },
        { relationship: 'oneMany', expected: 'manyOne' },
        { relationship: 'manyOne', expected: 'oneMany' },
      ] as const;

      for (const entry of cases) {
        const linkFieldId = createFieldId();
        const linkPayload: ICreateTableCommandInput = {
          baseId: ctx.baseId,
          name: `Projects (${entry.relationship})`,
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linkFieldId,
              name: `Company ${entry.relationship}`,
              options: {
                relationship: entry.relationship,
                foreignTableId: foreignTable.id,
                lookupFieldId: foreignPrimaryField.id,
              },
            },
          ],
        };

        const linkTable = await ctx.createTable(linkPayload);
        const updatedForeignTable = await ctx.getTableById(foreignTable.id);
        const foreignLinkField = updatedForeignTable.fields.find(
          (field) =>
            field.type === 'link' &&
            field.options.symmetricFieldId === linkFieldId &&
            field.options.foreignTableId === linkTable.id
        );
        expect(foreignLinkField).toBeDefined();
        if (!foreignLinkField || foreignLinkField.type !== 'link') return;

        expect(foreignLinkField.options.relationship).toBe(entry.expected);
      }
    });

    it('supports self-referencing links', async () => {
      const selfTableId = `tbl${'s'.repeat(16)}`;
      const primaryFieldId = createFieldId();
      const linkFieldId = createFieldId();

      await ctx.createTable({
        baseId: ctx.baseId,
        tableId: selfTableId,
        name: 'Self Links',
        fields: [
          { type: 'singleLineText', id: primaryFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: linkFieldId,
            name: 'Self',
            options: {
              relationship: 'manyMany',
              foreignTableId: selfTableId,
              lookupFieldId: primaryFieldId,
            },
          },
        ],
      });

      const selfTable = await ctx.getTableById(selfTableId);
      const linkFields = selfTable.fields.filter((field) => field.type === 'link');
      expect(linkFields.length).toBe(2);
      const symmetric = linkFields.find(
        (field) => field.type === 'link' && field.options.symmetricFieldId === linkFieldId
      );
      expect(symmetric).toBeDefined();
    });

    it('createTables with internal manyMany link and records updates symmetric link correctly', async () => {
      // Test scenario:
      // 1. Use createTables to create two tables with internal manyMany link
      // 2. Table B has records: B1, B2
      // 3. Table A has records: A1 with link to [B1, B2]
      // 4. After processOutbox, verify:
      //    - A1's link field shows [B1, B2]
      //    - B1's symmetric link shows [A1]
      //    - B2's symmetric link shows [A1]

      const tableAId = `tbl${'c'.repeat(16)}`;
      const tableBId = `tbl${'d'.repeat(16)}`;
      const aPrimaryFieldId = createFieldId();
      const bPrimaryFieldId = createFieldId();
      const aLinkFieldId = createFieldId();
      const recordB1Id = `rec${'1'.repeat(16)}`;
      const recordB2Id = `rec${'2'.repeat(16)}`;
      const recordA1Id = `rec${'3'.repeat(16)}`;

      const tables = await ctx.createTables({
        baseId: ctx.baseId,
        tables: [
          {
            tableId: tableBId,
            name: 'LinkTestB',
            fields: [
              { type: 'singleLineText', id: bPrimaryFieldId, name: 'Name', isPrimary: true },
            ],
            views: [{ type: 'grid' }],
            records: [
              { id: recordB1Id, fields: { [bPrimaryFieldId]: 'B1' } },
              { id: recordB2Id, fields: { [bPrimaryFieldId]: 'B2' } },
            ],
          },
          {
            tableId: tableAId,
            name: 'LinkTestA',
            fields: [
              { type: 'singleLineText', id: aPrimaryFieldId, name: 'Name', isPrimary: true },
              {
                type: 'link',
                id: aLinkFieldId,
                name: 'LinkToB',
                options: {
                  relationship: 'manyMany',
                  foreignTableId: tableBId,
                  lookupFieldId: bPrimaryFieldId,
                },
              },
            ],
            views: [{ type: 'grid' }],
            records: [
              {
                id: recordA1Id,
                fields: {
                  [aPrimaryFieldId]: 'A1',
                  [aLinkFieldId]: [
                    { id: recordB1Id, title: 'B1' },
                    { id: recordB2Id, title: 'B2' },
                  ],
                },
              },
            ],
          },
        ],
      });

      expect(tables).toHaveLength(2);

      // processOutbox() already runs until the computed queue quiesces.
      await ctx.testContainer.processOutbox();

      // Verify Table A records
      const recordsA = await ctx.listRecords(tableAId, { limit: 1000 });
      expect(recordsA).toHaveLength(1);

      const linkValueA = recordsA[0]?.fields[aLinkFieldId] as Array<{ id: string; title?: string }>;
      expect(linkValueA).toBeDefined();
      expect(Array.isArray(linkValueA)).toBe(true);
      expect(linkValueA.length).toBe(2);
      expect(linkValueA.map((l) => l.id).sort()).toEqual([recordB1Id, recordB2Id].sort());

      // Verify Table B records have symmetric link
      const recordsB = await ctx.listRecords(tableBId, { limit: 1000 });
      expect(recordsB).toHaveLength(2);

      // Find the symmetric link field in table B
      const tableB = await ctx.getTableById(tableBId);
      const symmetricLinkField = tableB.fields.find(
        (f) => f.type === 'link' && f.options.symmetricFieldId === aLinkFieldId
      );
      expect(symmetricLinkField).toBeDefined();
      if (!symmetricLinkField) return;

      const symFieldId = symmetricLinkField.id;

      // Both B1 and B2 should have A1 in their symmetric link
      for (const recordB of recordsB) {
        const symLinkValue = recordB.fields[symFieldId] as Array<{ id: string; title?: string }>;
        expect(symLinkValue).toBeDefined();
        expect(Array.isArray(symLinkValue)).toBe(true);
        expect(symLinkValue.length).toBe(1);
        expect(symLinkValue[0]?.id).toBe(recordA1Id);
      }
    });
  });
});
