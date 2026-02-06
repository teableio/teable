import { createFieldOkResponseSchema } from '@teable/v2-contract-http';
import { FieldKeyType } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const waitFor = async <T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 8000,
  intervalMs = 200
): Promise<T> => {
  const start = Date.now();
  let lastValue: T;
  while (Date.now() - start <= timeoutMs) {
    const value = await fn();
    lastValue = value;
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return lastValue!;
};

describe('v2 http record create/update multi-table chain (e2e)', () => {
  let ctx: SharedTestContext;
  const createdTableIds: string[] = [];

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 30000);

  const createChainTables = async () => {
    const companyTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'chain-companies',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', name: 'Score' },
      ],
      views: [{ type: 'grid' }],
    });
    createdTableIds.push(companyTable.id);

    const dealTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'chain-deals',
      fields: [
        { type: 'singleLineText', name: 'Deal', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
      views: [{ type: 'grid' }],
    });
    createdTableIds.push(dealTable.id);

    const invoiceTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'chain-invoices',
      fields: [
        { type: 'singleLineText', name: 'Invoice', isPrimary: true },
        { type: 'number', name: 'Total' },
      ],
      views: [{ type: 'grid' }],
    });
    createdTableIds.push(invoiceTable.id);

    return { companyTable, dealTable, invoiceTable };
  };

  const localCreateField = async (
    tableId: string,
    field: { name: string } & Record<string, unknown>
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseId: ctx.baseId, tableId, field }),
    });
    const rawBody = await response.json();
    if (!response.ok) {
      throw new Error(`CreateField failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = createFieldOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to create field: ${JSON.stringify(rawBody)}`);
    }
    const table = parsed.data.data.table;
    const created = table.fields.find((item) => item.name === field.name);
    if (!created) {
      throw new Error(`Failed to resolve created field: ${JSON.stringify(field)}`);
    }
    return created;
  };

  const cleanupTables = async () => {
    const ids = createdTableIds.splice(0, createdTableIds.length).reverse();
    for (const tableId of ids) {
      await ctx.deleteTable(tableId);
    }
  };

  it('creates records and updates via API with link/lookup/formula chains', async () => {
    const { companyTable, dealTable, invoiceTable } = await createChainTables();

    const companyNameFieldId = companyTable.fields.find((f) => f.name === 'Name')?.id;
    const companyScoreFieldId = companyTable.fields.find((f) => f.name === 'Score')?.id;
    const dealAmountFieldId = dealTable.fields.find((f) => f.name === 'Amount')?.id;
    const invoiceTotalFieldId = invoiceTable.fields.find((f) => f.name === 'Total')?.id;

    if (!companyNameFieldId || !companyScoreFieldId || !dealAmountFieldId || !invoiceTotalFieldId) {
      throw new Error('Failed to resolve base field ids');
    }

    const dealCompanyLink = await localCreateField(dealTable.id, {
      name: 'Company',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: companyTable.id,
        lookupFieldId: companyNameFieldId,
        isOneWay: true,
      },
    });

    const dealCompanyLookup = await localCreateField(dealTable.id, {
      name: 'Company Name',
      type: 'lookup',
      options: {
        foreignTableId: companyTable.id,
        linkFieldId: dealCompanyLink.id,
        lookupFieldId: companyNameFieldId,
      },
    });

    const dealCompanyFormula = await localCreateField(dealTable.id, {
      name: 'Company Label',
      type: 'formula',
      options: {
        expression: `CONCATENATE({${dealCompanyLookup.id}}, "-", {${dealAmountFieldId}})`,
      },
    });

    const invoiceDealLink = await localCreateField(invoiceTable.id, {
      name: 'Deal',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: dealTable.id,
        lookupFieldId: dealCompanyFormula.id,
        isOneWay: true,
      },
    });

    const invoiceDealLookup = await localCreateField(invoiceTable.id, {
      name: 'Deal Company',
      type: 'lookup',
      options: {
        foreignTableId: dealTable.id,
        linkFieldId: invoiceDealLink.id,
        lookupFieldId: dealCompanyLookup.id,
      },
    });

    const invoiceLabelFormula = await localCreateField(invoiceTable.id, {
      name: 'Invoice Label',
      type: 'formula',
      options: {
        expression: `CONCATENATE({${invoiceDealLookup.id}}, "-", {${invoiceTotalFieldId}})`,
      },
    });

    const company1 = await ctx.createRecord(companyTable.id, {
      [companyNameFieldId]: 'Acme',
      [companyScoreFieldId]: 10,
    });
    await ctx.createRecord(companyTable.id, {
      [companyNameFieldId]: 'Northwind',
      [companyScoreFieldId]: 20,
    });

    const deal1 = await ctx.createRecord(dealTable.id, {
      [dealAmountFieldId]: 100,
    });
    const deal2 = await ctx.createRecord(dealTable.id, {
      [dealAmountFieldId]: 200,
    });
    const invoice1 = await ctx.createRecord(invoiceTable.id, {
      [invoiceTotalFieldId]: 50,
    });
    const invoice2 = await ctx.createRecord(invoiceTable.id, {
      [invoiceTotalFieldId]: 80,
    });

    await ctx.updateRecord(dealTable.id, deal1.id, {
      [dealCompanyLink.id]: { id: company1.id },
    });
    await ctx.updateRecord(dealTable.id, deal2.id, {
      [dealCompanyLink.id]: { id: company1.id },
    });

    await ctx.updateRecord(invoiceTable.id, invoice1.id, {
      [invoiceDealLink.id]: { id: deal1.id },
    });
    await ctx.updateRecord(invoiceTable.id, invoice2.id, {
      [invoiceDealLink.id]: { id: deal2.id },
    });

    await Promise.all([
      ctx.updateRecord(companyTable.id, company1.id, {
        [companyNameFieldId]: 'Acme Updated',
      }),
      ctx.updateRecord(dealTable.id, deal1.id, {
        [dealAmountFieldId]: 150,
      }),
      ctx.updateRecord(invoiceTable.id, invoice1.id, {
        [invoiceTotalFieldId]: 90,
      }),
    ]);

    await ctx.drainOutbox();

    const dealRecords = await ctx.listRecords(dealTable.id, { baseId: ctx.baseId });
    const dealRecord = dealRecords.find((record) => record.id === deal1.id);
    expect(dealRecord?.fields[dealCompanyFormula.id]).toContain('Acme Updated');

    const invoiceRecords = await ctx.listRecords(invoiceTable.id, { baseId: ctx.baseId });
    const invoiceRecord = invoiceRecords.find((record) => record.id === invoice1.id);
    expect(invoiceRecord?.fields[invoiceLabelFormula.id]).toContain('Acme Updated');

    const invoiceById = await waitFor(
      () => ctx.listRecordsWithPagination(invoiceTable.id, { baseId: ctx.baseId }),
      (records) =>
        records.records.some((record) => typeof record.fields[invoiceLabelFormula.id] === 'string')
    );
    const invoiceMatch = invoiceById.records.find((record) => record.id === invoice1.id);
    expect(invoiceMatch?.fields[invoiceLabelFormula.id]).toContain('Acme Updated');
    expect(invoiceMatch?.fields[invoiceDealLookup.id]).toEqual(['Acme Updated']);

    await cleanupTables();
  }, 60000);

  it('creates records with typecast updates through API', async () => {
    const { companyTable, dealTable } = await createChainTables();

    const companyNameFieldId = companyTable.fields.find((f) => f.name === 'Name')?.id;
    if (!companyNameFieldId) throw new Error('Failed to resolve company Name field id');

    const dealAmountFieldId = dealTable.fields.find((f) => f.name === 'Amount')?.id;
    if (!dealAmountFieldId) throw new Error('Failed to resolve deal Amount field id');

    const dealCompanyLink = await localCreateField(dealTable.id, {
      name: 'Company',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: companyTable.id,
        lookupFieldId: companyNameFieldId,
        isOneWay: true,
      },
    });

    const company = await ctx.createRecord(companyTable.id, {
      [companyNameFieldId]: 'Umbrella',
    });
    const deal = await ctx.createRecord(dealTable.id, {
      [dealAmountFieldId]: 60,
    });

    const updateResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: dealTable.id,
        recordId: deal.id,
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        fields: {
          [dealAmountFieldId]: '200',
          [dealCompanyLink.id]: { id: company.id },
        },
      }),
    });

    expect(updateResponse.ok).toBe(true);
    await ctx.drainOutbox();

    const records = await ctx.listRecords(dealTable.id, { baseId: ctx.baseId });
    const updated = records.find((record) => record.id === deal.id);
    expect(updated?.fields[dealAmountFieldId]).toBe(200);

    await cleanupTables();
  }, 60000);
});
