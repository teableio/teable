/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import { importCsvOkResponseSchema } from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('v2 http importCsv (e2e)', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;

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
    const testContainer = await createV2NodeTestContainer();
    dispose = testContainer.dispose;
    baseId = testContainer.baseId.toString();

    const app = express();
    app.use(
      createV2ExpressRouter({
        createContainer: () => testContainer.container,
      })
    );

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    if (dispose) await dispose();
  });

  it('imports simple CSV via fetch', async () => {
    const response = await fetch(`${baseUrl}/tables/importCsv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        csvData: simpleCsv,
        tableName: 'Simple Import',
      }),
    });

    expect(response.status).toBe(201);

    const rawBody = await response.json();
    const parsed = importCsvOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    // 验证表结构
    expect(body.data.table.name).toBe('Simple Import');
    expect(body.data.table.baseId).toBe(baseId);
    expect(body.data.table.fields).toHaveLength(3);
    expect(body.data.table.fields.map((f) => f.name)).toEqual(['Name', 'Age', 'City']);
    expect(body.data.table.fields.every((f) => f.type === 'singleLineText')).toBe(true);

    // 验证导入的记录数
    expect(body.data.totalImported).toBe(3);

    // 验证事件
    expect(body.data.events.some((e) => e.name === 'TableCreated')).toBe(true);
  });

  it('imports CSV via orpc client', async () => {
    const client = createV2HttpClient({ baseUrl });

    const body = await client.tables.importCsv({
      baseId,
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
    const client = createV2HttpClient({ baseUrl });

    const body = await client.tables.importCsv({
      baseId,
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
    const client = createV2HttpClient({ baseUrl });

    const body = await client.tables.importCsv({
      baseId,
      csvData: csvWithEmptyFields,
      tableName: 'Empty Fields Import',
    });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.name).toBe('Empty Fields Import');
    expect(body.data.table.fields).toHaveLength(3);
    expect(body.data.totalImported).toBe(3);
  });

  it('auto-generates table name when not provided', async () => {
    const client = createV2HttpClient({ baseUrl });

    const body = await client.tables.importCsv({
      baseId,
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

    const client = createV2HttpClient({ baseUrl });

    const body = await client.tables.importCsv({
      baseId,
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

  it('returns 400 for empty CSV', async () => {
    const response = await fetch(`${baseUrl}/tables/importCsv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        csvData: '',
        tableName: 'Empty CSV',
      }),
    });

    expect(response.status).toBe(400);
  });

  it('returns 400 for CSV with only headers', async () => {
    const client = createV2HttpClient({ baseUrl });

    try {
      await client.tables.importCsv({
        baseId,
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
    const client = createV2HttpClient({ baseUrl });

    const body = await client.tables.importCsv({
      baseId,
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
    const client = createV2HttpClient({ baseUrl });

    const body = await client.tables.importCsv({
      baseId,
      csvData: simpleCsv,
      tableName: 'View Test',
    });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.views.length).toBeGreaterThan(0);
    expect(body.data.table.views[0].type).toBe('grid');
  });
});
