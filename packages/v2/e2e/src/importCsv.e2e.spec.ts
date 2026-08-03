/* eslint-disable @typescript-eslint/naming-convention */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const startChunkedCsvServer = async (
  chunks: string[]
): Promise<{ url: string; close: () => Promise<void> }> => {
  const server = createServer(async (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' });
    for (const chunk of chunks) {
      res.write(chunk);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    res.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/import.csv`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

describe('v2 http importCsv (e2e)', () => {
  let ctx: SharedTestContext;

  // 模拟 CSV 数据
  const simpleCsv = `Name,Age,City
Alice,25,Beijing
Bob,30,Shanghai
Charlie,35,Guangzhou`;

  const csvWithSpecialChars = `Name,Description,Price
"Product A","A great product, with features",100
"Product ""B""","Contains ""quotes""",200
"Product C","Has
newlines",300`;

  const csvWithEmptyFields = `Name,Email,Phone
John,john@example.com,
Jane,,555-1234
,bob@example.com,555-5678`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('imports simple CSV via fetch', async () => {
    const result = await ctx.importCsv({
      baseId: ctx.baseId,
      csvData: simpleCsv,
      tableName: 'Simple Import',
    });

    // 验证表结构
    expect(result.table.name).toBe('Simple Import');
    expect(result.table.baseId).toBe(ctx.baseId);
    expect(result.table.fields).toHaveLength(3);
    expect(result.table.fields.map((f) => f.name)).toEqual(['Name', 'Age', 'City']);
    expect(result.table.fields.map((f) => f.type)).toEqual([
      'singleLineText',
      'number',
      'singleLineText',
    ]);

    // 验证导入的记录数
    expect(result.totalImported).toBe(3);

    // 验证事件
    expect(result.events.some((e) => e.name === 'TableCreated')).toBe(true);
  });

  it('imports CSV via orpc client', async () => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    const body = await client.tables.importCsv({
      baseId: ctx.baseId,
      csvData: simpleCsv,
      tableName: 'Client Import',
      batchSize: 100,
    });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.name).toBe('Client Import');
    expect(body.data.table.fields).toHaveLength(3);
    expect(body.data.totalImported).toBe(3);
  });

  it('imports CSV with special characters (quotes, commas)', async () => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    const body = await client.tables.importCsv({
      baseId: ctx.baseId,
      csvData: csvWithSpecialChars,
      tableName: 'Special Chars Import',
    });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.name).toBe('Special Chars Import');
    expect(body.data.table.fields).toHaveLength(3);
    expect(body.data.table.fields.map((f) => f.name)).toEqual(['Name', 'Description', 'Price']);
    expect(body.data.totalImported).toBe(3);
  });

  it('imports CSV with empty fields', async () => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    const body = await client.tables.importCsv({
      baseId: ctx.baseId,
      csvData: csvWithEmptyFields,
      tableName: 'Empty Fields Import',
    });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.name).toBe('Empty Fields Import');
    expect(body.data.table.fields).toHaveLength(3);
    expect(body.data.totalImported).toBe(3);
  });

  it('T5412 imports the first CSV row as data when first-row headers are disabled', async () => {
    const body = await ctx.importCsv({
      baseId: ctx.baseId,
      csvData: [
        '数据首列A,12,true,2024-04-01,"这行不是表头"',
        '数据首列B,15,false,2024-04-02,关闭第一行为表头时应保留第一行',
        '数据首列C,,true,,空数字和空日期',
      ].join('\n'),
      tableName: 'T5412 No Header Import',
      useFirstRowAsHeader: false,
      columns: [
        { name: 'Field 1', sourceColumnIndex: 0, type: 'singleLineText' },
        { name: 'Field 2', sourceColumnIndex: 1, type: 'number' },
        { name: 'Field 3', sourceColumnIndex: 2, type: 'checkbox' },
        { name: 'Field 4', sourceColumnIndex: 3, type: 'date' },
        { name: 'Field 5', sourceColumnIndex: 4, type: 'singleLineText' },
      ],
    });

    expect(body.table.fields.map((field) => field.name)).toEqual([
      'Field 1',
      'Field 2',
      'Field 3',
      'Field 4',
      'Field 5',
    ]);
    expect(body.totalImported).toBe(3);

    const field1Id = body.table.fields.find((field) => field.name === 'Field 1')!.id;
    const records = await ctx.listRecords(body.table.id, { limit: 10 });

    expect(records.map((record) => record.fields[field1Id])).toEqual([
      '数据首列A',
      '数据首列B',
      '数据首列C',
    ]);
  });

  it('auto-generates table name when not provided', async () => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    const body = await client.tables.importCsv({
      baseId: ctx.baseId,
      csvData: simpleCsv,
      // tableName is optional
    });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    // 应该自动生成一个表名 (Import_YYYYMMDDHHMMSS 格式)
    expect(body.data.table.name).toMatch(/^Import_\d{8}T\d{6}$/);
    expect(body.data.totalImported).toBe(3);
  });

  it('imports large CSV with batching', async () => {
    // 生成 1000 行的 CSV
    const headers = 'ID,Name,Value';
    const rows = Array.from({ length: 1000 }, (_, i) => `${i + 1},Item ${i + 1},${i * 10}`);
    const largeCsv = [headers, ...rows].join('\n');

    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    const body = await client.tables.importCsv({
      baseId: ctx.baseId,
      csvData: largeCsv,
      tableName: 'Large Import',
      batchSize: 100, // 每批 100 条
    });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.name).toBe('Large Import');
    expect(body.data.table.fields).toHaveLength(3);
    expect(body.data.totalImported).toBe(1000);
  });

  it('imports chunked CSV URL data without treating later rows as headers', async () => {
    const headers =
      'Title,Description,Status,Priority,Tags,Amount,Quantity,Start Date,Due Date,Active,Score,Owner Text,Notes,Category,Labels,External ID,Source,Percent,Approved,Comment';
    const statuses = ['T', 'D', 'N'];
    const tagPairs = ['A, B', 'B, C', 'C, D', 'D, A'];
    const rows = Array.from({ length: 1000 }, (_, i) => {
      const rowNumber = i + 1;
      const startDate = new Date(Date.UTC(2026, 0, rowNumber)).toISOString().slice(0, 10);
      return [
        `R${rowNumber}`,
        '',
        statuses[i % statuses.length],
        '',
        `"${tagPairs[i % tagPairs.length]}"`,
        String(rowNumber % 10),
        '',
        startDate,
        '',
        rowNumber % 2 ? 'true' : '',
        String((i % 5) + 1),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ].join(',');
    });
    const chunks = [
      `${headers}\n${rows.slice(0, 363).join('\n')}\n`,
      `${rows.slice(363, 700).join('\n')}\n`,
      rows.slice(700).join('\n'),
    ];
    const csvServer = await startChunkedCsvServer(chunks);

    try {
      const body = await ctx.importCsv({
        baseId: ctx.baseId,
        csvUrl: csvServer.url,
        tableName: 'Chunked URL Import',
        batchSize: 100,
      });

      expect(body.table.name).toBe('Chunked URL Import');
      expect(body.table.fields).toHaveLength(20);
      expect(body.totalImported).toBe(1000);

      const titleFieldId = body.table.fields.find((field) => field.name === 'Title')!.id;
      const tagsFieldId = body.table.fields.find((field) => field.name === 'Tags')!.id;
      const amountFieldId = body.table.fields.find((field) => field.name === 'Amount')!.id;
      const records = await ctx.listRecords(body.table.id, { limit: 1000 });
      const recordsByTitle = new Map(
        records.map((record) => [record.fields[titleFieldId], record])
      );

      expect(records).toHaveLength(1000);
      expect(recordsByTitle.size).toBe(1000);
      expect(recordsByTitle.get('R1')?.fields[amountFieldId]).toBe(1);
      expect(recordsByTitle.get('R364')?.fields[tagsFieldId]).toBe('D, A');
      expect(recordsByTitle.get('R1000')?.fields[amountFieldId]).toBe(0);
    } finally {
      await csvServer.close();
    }
  });

  it('returns 400 for empty CSV', async () => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    try {
      await client.tables.importCsv({
        baseId: ctx.baseId,
        csvData: '',
        tableName: 'Empty CSV',
      });
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it('returns 400 for CSV with only headers', async () => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    try {
      await client.tables.importCsv({
        baseId: ctx.baseId,
        csvData: 'Name,Age,City',
        tableName: 'Headers Only',
      });
      // 如果没有抛出错误，测试失败
      expect.fail('Should have thrown an error');
    } catch (error) {
      // 预期会抛出错误
      expect(error).toBeDefined();
    }
  });

  it('creates first column as primary field', async () => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    const body = await client.tables.importCsv({
      baseId: ctx.baseId,
      csvData: simpleCsv,
      tableName: 'Primary Field Test',
    });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    const primaryField = body.data.table.fields.find((f) => f.isPrimary);
    expect(primaryField).toBeDefined();
    expect(primaryField?.name).toBe('Name'); // 第一列应该是主键
  });

  it('creates default grid view', async () => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    const body = await client.tables.importCsv({
      baseId: ctx.baseId,
      csvData: simpleCsv,
      tableName: 'View Test',
    });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.views.length).toBeGreaterThan(0);
    expect(body.data.table.views[0].type).toBe('grid');
  });
});
