/* eslint-disable @typescript-eslint/naming-convention */
/**
 * V2 Formula E2E Tests
 *
 * 这个测试文件基于 v1 的 formula.e2e-spec.ts 和 formula-field.e2e-spec.ts 迁移而来
 * 测试用例保持一致，但实现方式使用 v2 的测试框架
 *
 * 测试覆盖范围：
 * 1. 基本公式计算（记录创建/更新后的计算）
 * 2. 引用各种字段类型的公式（文本、数字、日期、评分、复选框、选择）
 * 3. 二元运算符类型强制转换
 * 4. 布尔运算符组合
 * 5. LAST_MODIFIED_TIME 带字段参数
 * 6. 数值函数（ROUND, CEILING, FLOOR 等）
 * 7. 文本函数（CONCATENATE, LEFT, RIGHT 等）
 * 8. 逻辑函数（IF, AND, OR, NOT, SWITCH）
 * 9. 日期时间函数（DATE_ADD, DATETIME_DIFF, IS_SAME 等）
 * 10. 链接和查找字段公式
 * 11. 条件引用公式
 * 12. 错误处理场景
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  createFieldOkResponseSchema,
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest';

describe('v2 http formula (e2e)', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;
  let testContainer: IV2NodeTestContainer;
  const uniqueName = (prefix: string) =>
    `${prefix} ${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    testContainer = await createV2NodeTestContainer();
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

  const processOutbox = async (times = 1) => {
    for (let i = 0; i < times; i += 1) {
      await testContainer.processOutbox();
    }
  };

  const listRecords = async (tableIdParam: string) => {
    const params = new URLSearchParams({ tableId: tableIdParam });
    const response = await fetch(`${baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list records: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse list records response');
    }
    return parsed.data.data.records;
  };

  // ============================================================================
  // 1. 基本公式计算 - 记录创建后的计算
  // ============================================================================
  describe('basic formula calculation after record creation', () => {
    /**
     * 测试场景：创建记录后公式字段应正确计算
     * 公式：{numberField} * 2
     * 预期：数字字段值乘以2
     */
    it('should calculate formula after record creation - {numberField} * 2', async () => {
      // 1. 创建表，包含数字字段
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'Formula Calc Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Amount' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';

      // 2. 创建公式字段
      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Double Amount',
            options: {
              expression: `{${numberFieldId}} * 2`,
            },
          },
        }),
      });
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Double Amount')?.id ?? '';

      // 3. 创建记录
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 21,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 4. 处理 outbox 以触发公式计算
      await processOutbox();

      // 5. 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      // 6. 验证公式计算结果
      expect(record.fields[formulaFieldId]).toBe(42); // 21 * 2 = 42
    });

    /**
     * 测试场景：更新记录后公式字段应重新计算
     * 公式：{numberField} + 10
     * 预期：更新数字字段后，公式结果应更新
     */
    it('should recalculate formula after record update - {numberField} + 10', async () => {
      // 1. 创建表，包含数字字段
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'Formula Recalc Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      // 2. 创建公式字段
      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Plus Ten',
            options: {
              expression: `{${numberFieldId}} + 10`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Plus Ten')?.id ?? '';

      // 3. 创建记录
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 5,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 4. 处理 outbox 以触发公式计算
      await processOutbox();

      // 5. 通过 listRecords 获取计算后的记录
      let records = await listRecords(table.id);
      let record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;
      expect(record.fields[formulaFieldId]).toBe(15); // 5 + 10 = 15

      // 6. 更新记录
      const updateRecordResponse = await fetch(`${baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          recordId,
          fields: {
            [numberFieldId]: 20,
          },
        }),
      });
      expect(updateRecordResponse.status).toBe(200);
      const updateRaw = await updateRecordResponse.json();
      const updateParsed = updateRecordOkResponseSchema.safeParse(updateRaw);
      expect(updateParsed.success).toBe(true);
      if (!updateParsed.success || !updateParsed.data.ok) return;

      // 7. 处理 outbox 以触发公式重新计算
      await processOutbox();

      // 8. 通过 listRecords 获取重新计算后的记录
      records = await listRecords(table.id);
      record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      // 9. 验证公式重新计算
      expect(record.fields[formulaFieldId]).toBe(30); // 20 + 10 = 30
    });

    /**
     * 测试场景：创建空记录时公式字段应正确处理空值
     * 公式：IF({textField}="", "empty", {textField})
     * 预期：空值时返回 "empty"
     */
    it('should handle empty values in formula - IF({textField}="", "empty", {textField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('Empty Values Formula Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', name: 'Text' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Empty Check',
            options: {
              expression: `IF({${textFieldId}}="", "empty", {${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Empty Check')?.id ?? '';

      const createEmptyRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: '',
          },
        }),
      });
      expect(createEmptyRecordResponse.status).toBe(201);
      const emptyRecordRaw = await createEmptyRecordResponse.json();
      const emptyRecordParsed = createRecordOkResponseSchema.safeParse(emptyRecordRaw);
      expect(emptyRecordParsed.success).toBe(true);
      if (!emptyRecordParsed.success || !emptyRecordParsed.data.ok) return;

      const emptyRecordId = emptyRecordParsed.data.data.record.id;

      const createFilledRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: 'Hello',
          },
        }),
      });
      expect(createFilledRecordResponse.status).toBe(201);
      const filledRecordRaw = await createFilledRecordResponse.json();
      const filledRecordParsed = createRecordOkResponseSchema.safeParse(filledRecordRaw);
      expect(filledRecordParsed.success).toBe(true);
      if (!filledRecordParsed.success || !filledRecordParsed.data.ok) return;

      const filledRecordId = filledRecordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const emptyRecord = records.find((r) => r.id === emptyRecordId);
      const filledRecord = records.find((r) => r.id === filledRecordId);

      expect(emptyRecord).toBeDefined();
      expect(filledRecord).toBeDefined();
      if (!emptyRecord || !filledRecord) return;

      expect(emptyRecord.fields[formulaFieldId]).toBe('empty');
      expect(filledRecord.fields[formulaFieldId]).toBe('Hello');
    });
  });

  // ============================================================================
  // 2. 引用各种字段类型的公式
  // ============================================================================
  describe('formula referencing various field types', () => {
    /**
     * 测试场景：公式引用单行文本字段
     * 公式：UPPER({textField})
     * 预期：文本转换为大写
     */
    it('should create formula referencing text field - UPPER({textField})', async () => {
      // 1. 创建表
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'Text Formula Test',
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Title')?.id ?? '';

      // 2. 创建公式字段
      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Upper Title',
            options: {
              expression: `UPPER({${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Upper Title')?.id ?? '';

      // 3. 创建记录
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: 'hello world',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 4. 处理 outbox 以触发公式计算
      await processOutbox();

      // 5. 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      // 6. 验证公式结果
      expect(record.fields[formulaFieldId]).toBe('HELLO WORLD');
    });

    /**
     * 测试场景：公式引用数字字段
     * 公式：{numberField} * 2
     * 预期：数字乘以2
     */
    it('should create formula referencing number field - {numberField} * 2', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'Number Formula Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Double Value',
            options: {
              expression: `{${numberFieldId}} * 2`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Double Value')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 50,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(100); // 50 * 2
    });

    /**
     * 测试场景：公式引用日期字段
     * 公式：YEAR({dateField})
     * 预期：提取年份
     */
    it('should create formula referencing date field - YEAR({dateField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'Date Formula Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'EventDate' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'EventDate')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Event Year',
            options: {
              expression: `YEAR({${dateFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Event Year')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [dateFieldId]: '2024-06-15T00:00:00.000Z',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(2024);
    });

    /**
     * 测试场景：公式引用评分字段
     * 公式：{ratingField} + 1
     * 预期：评分加1
     */
    it('should create formula referencing rating field - {ratingField} + 1', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'Rating Formula Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'rating', name: 'Score', options: { max: 5 } },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const ratingFieldId = table.fields.find((f) => f.name === 'Score')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Score Plus One',
            options: {
              expression: `{${ratingFieldId}} + 1`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Score Plus One')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [ratingFieldId]: 4,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(5); // 4 + 1 = 5
    });

    /**
     * 测试场景：公式引用复选框字段
     * 公式：IF({checkboxField}, "Yes", "No")
     * 预期：勾选返回 "Yes"，否则返回 "No"
     */
    it('should create formula referencing checkbox field - IF({checkboxField}, "Yes", "No")', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'Checkbox Formula Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'checkbox', name: 'IsActive' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const checkboxFieldId = table.fields.find((f) => f.name === 'IsActive')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Status',
            options: {
              expression: `IF({${checkboxFieldId}}, "Yes", "No")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Status')?.id ?? '';

      // 测试 true 值
      const createRecordResponse1 = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [checkboxFieldId]: true,
          },
        }),
      });
      expect(createRecordResponse1.status).toBe(201);
      const recordRaw1 = await createRecordResponse1.json();
      const recordParsed1 = createRecordOkResponseSchema.safeParse(recordRaw1);
      expect(recordParsed1.success).toBe(true);
      if (!recordParsed1.success || !recordParsed1.data.ok) return;

      const recordId1 = recordParsed1.data.data.record.id;

      // 测试 false 值
      const createRecordResponse2 = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [checkboxFieldId]: false,
          },
        }),
      });
      expect(createRecordResponse2.status).toBe(201);
      const recordRaw2 = await createRecordResponse2.json();
      const recordParsed2 = createRecordOkResponseSchema.safeParse(recordRaw2);
      expect(recordParsed2.success).toBe(true);
      if (!recordParsed2.success || !recordParsed2.data.ok) return;

      const recordId2 = recordParsed2.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record1 = records.find((r) => r.id === recordId1);
      const record2 = records.find((r) => r.id === recordId2);

      expect(record1).toBeDefined();
      expect(record2).toBeDefined();
      if (!record1 || !record2) return;

      expect(record1.fields[formulaFieldId]).toBe('Yes');
      expect(record2.fields[formulaFieldId]).toBe('No');
    });

    /**
     * 测试场景：公式引用单选字段
     * 公式：CONCATENATE("Selected: ", {selectField})
     * 预期：拼接选项名称
     */
    it('should create formula referencing select field - CONCATENATE("Selected: ", {selectField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('Select Formula Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleSelect', name: 'Status', options: ['A', 'B'] },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const selectField = table.fields.find((f) => f.name === 'Status');
      const selectFieldId = selectField?.id ?? '';
      const choices =
        (selectField?.options as { choices?: Array<{ id: string; name: string }> })?.choices ?? [];
      const optionB = choices.find((choice) => choice.name === 'B');
      if (!selectFieldId || !optionB?.id) {
        throw new Error('Missing select field or option metadata');
      }

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Selected Text',
            options: {
              expression: `CONCATENATE("Selected: ", {${selectFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Selected Text')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [selectFieldId]: optionB.id,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('Selected: B');
    });

    /**
     * 测试场景：公式引用多选字段
     * 公式：ARRAYJOIN({multiSelectField}, ", ")
     * 预期：用逗号连接多个选项
     */
    it('should create formula referencing multiple select field - ARRAYJOIN({multiSelectField}, ", ")', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('Multi Select Formula Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'multipleSelect', name: 'Tags', options: ['Tag A', 'Tag B', 'Tag C'] },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const multiSelectField = table.fields.find((f) => f.name === 'Tags');
      const multiSelectFieldId = multiSelectField?.id ?? '';
      const choices =
        (multiSelectField?.options as { choices?: Array<{ id: string; name: string }> })?.choices ??
        [];
      const tagA = choices.find((choice) => choice.name === 'Tag A');
      const tagC = choices.find((choice) => choice.name === 'Tag C');
      if (!multiSelectFieldId || !tagA?.id || !tagC?.id) {
        throw new Error('Missing multi select field or option metadata');
      }

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Joined Tags',
            options: {
              expression: `ARRAYJOIN({${multiSelectFieldId}}, ", ")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Joined Tags')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [multiSelectFieldId]: [tagA.id, tagC.id],
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('Tag A, Tag C');
    });

    /**
     * 测试场景：公式引用长文本字段
     * 公式：LEN({longTextField})
     * 预期：返回文本长度
     */
    it('should create formula referencing long text field - LEN({longTextField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('Long Text Formula Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'longText', name: 'Description' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const longTextFieldId = table.fields.find((f) => f.name === 'Description')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Text Length',
            options: {
              expression: `LEN({${longTextFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Text Length')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [longTextFieldId]: 'abcdef',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(6);
    });

    /**
     * 测试场景：公式引用用户字段
     * 公式：IF({userField}, "assigned", "unassigned")
     * 预期：有用户返回 "assigned"
     */
    it('should create formula referencing user field - IF({userField}, "assigned", "unassigned")', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('User Formula Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'user',
              name: 'Assignee',
              options: {
                isMultiple: true,
                shouldNotify: false,
              },
            },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const userFieldId = table.fields.find((f) => f.name === 'Assignee')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Assignment Status',
            options: {
              expression: `IF({${userFieldId}}, "assigned", "unassigned")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Assignment Status')?.id ?? '';

      const createUnassignedResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {},
        }),
      });
      expect(createUnassignedResponse.status).toBe(201);
      const unassignedRaw = await createUnassignedResponse.json();
      const unassignedParsed = createRecordOkResponseSchema.safeParse(unassignedRaw);
      expect(unassignedParsed.success).toBe(true);
      if (!unassignedParsed.success || !unassignedParsed.data.ok) return;

      const unassignedRecordId = unassignedParsed.data.data.record.id;

      const createAssignedResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [userFieldId]: [{ id: 'usr1', title: 'User 1' }],
          },
        }),
      });
      expect(createAssignedResponse.status).toBe(201);
      const assignedRaw = await createAssignedResponse.json();
      const assignedParsed = createRecordOkResponseSchema.safeParse(assignedRaw);
      expect(assignedParsed.success).toBe(true);
      if (!assignedParsed.success || !assignedParsed.data.ok) return;

      const assignedRecordId = assignedParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const unassignedRecord = records.find((r) => r.id === unassignedRecordId);
      const assignedRecord = records.find((r) => r.id === assignedRecordId);
      expect(unassignedRecord).toBeDefined();
      expect(assignedRecord).toBeDefined();
      if (!unassignedRecord || !assignedRecord) return;

      expect(unassignedRecord.fields[formulaFieldId]).toBe(null);
      expect(assignedRecord.fields[formulaFieldId]).toBe('assigned');
    });

    /**
     * 测试场景：公式引用自动编号字段
     * 公式：{autoNumberField} + 1000
     * 预期：自动编号加1000
     */
    it('should create formula referencing auto number field - {autoNumberField} + 1000', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('Auto Number Formula Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      const createAutoNumberResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'autoNumber',
            name: 'Auto No',
          },
        }),
      });
      expect(createAutoNumberResponse.status).toBe(200);
      const autoNumberRaw = await createAutoNumberResponse.json();
      const autoNumberParsed = createFieldOkResponseSchema.safeParse(autoNumberRaw);
      expect(autoNumberParsed.success).toBe(true);
      if (!autoNumberParsed.success || !autoNumberParsed.data.ok) return;

      const autoNumberFieldId =
        autoNumberParsed.data.data.table.fields.find((f) => f.name === 'Auto No')?.id ?? '';

      const createFormulaResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Auto Plus 1000',
            options: {
              expression: `IF({${primaryFieldId}}, {${autoNumberFieldId}} + 1000, {${autoNumberFieldId}} + 1000)`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;

      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Auto Plus 1000')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [primaryFieldId]: 'Row 1',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const autoValue = record.fields[autoNumberFieldId];
      expect(typeof autoValue).toBe('number');
      if (typeof autoValue !== 'number') return;

      expect(record.fields[formulaFieldId]).toBe(autoValue + 1000);
    });

    /**
     * 测试场景：公式引用创建时间字段
     * 公式：YEAR({createdTimeField})
     * 预期：提取创建时间的年份
     */
    it('should create formula referencing created time field - YEAR({createdTimeField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('Created Time Formula Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      const createCreatedTimeResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'createdTime',
            name: 'Created At',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            },
          },
        }),
      });
      expect(createCreatedTimeResponse.status).toBe(200);
      const createdTimeRaw = await createCreatedTimeResponse.json();
      const createdTimeParsed = createFieldOkResponseSchema.safeParse(createdTimeRaw);
      expect(createdTimeParsed.success).toBe(true);
      if (!createdTimeParsed.success || !createdTimeParsed.data.ok) return;

      const createdTimeFieldId =
        createdTimeParsed.data.data.table.fields.find((f) => f.name === 'Created At')?.id ?? '';

      const createFormulaResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Created Year',
            options: {
              expression: `IF({${primaryFieldId}}, YEAR({${createdTimeFieldId}}), YEAR({${createdTimeFieldId}}))`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;

      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Created Year')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [primaryFieldId]: 'Row 1',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const createdAt = record.fields[createdTimeFieldId];
      expect(typeof createdAt).toBe('string');
      if (typeof createdAt !== 'string') return;

      const expectedYear = new Date(createdAt).getUTCFullYear();
      expect(record.fields[formulaFieldId]).toBe(expectedYear);
    });

    /**
     * 测试场景：公式引用最后修改时间字段
     * 公式：DATETIME_FORMAT({lastModifiedTimeField}, "YYYY-MM-DD")
     * 预期：格式化最后修改时间
     */
    it('should create formula referencing last modified time field - DATETIME_FORMAT({lastModifiedTimeField}, "YYYY-MM-DD")', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('Last Modified Time Formula Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      const createLastModifiedResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'lastModifiedTime',
            name: 'Last Modified At',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
              trackedFieldIds: [primaryFieldId],
            },
          },
        }),
      });
      expect(createLastModifiedResponse.status).toBe(200);
      const lastModifiedRaw = await createLastModifiedResponse.json();
      const lastModifiedParsed = createFieldOkResponseSchema.safeParse(lastModifiedRaw);
      expect(lastModifiedParsed.success).toBe(true);
      if (!lastModifiedParsed.success || !lastModifiedParsed.data.ok) return;

      const lastModifiedTimeFieldId =
        lastModifiedParsed.data.data.table.fields.find((f) => f.name === 'Last Modified At')?.id ??
        '';

      const createFormulaResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Last Modified Date',
            options: {
              expression: `IF({${primaryFieldId}}, DATETIME_FORMAT({${lastModifiedTimeFieldId}}, "YYYY-MM-DD"), DATETIME_FORMAT({${lastModifiedTimeFieldId}}, "YYYY-MM-DD"))`,
            },
          },
        }),
      });
      expect(createFormulaResponse.status).toBe(200);
      const formulaRaw = await createFormulaResponse.json();
      const formulaParsed = createFieldOkResponseSchema.safeParse(formulaRaw);
      expect(formulaParsed.success).toBe(true);
      if (!formulaParsed.success || !formulaParsed.data.ok) return;

      const formulaFieldId =
        formulaParsed.data.data.table.fields.find((f) => f.name === 'Last Modified Date')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [primaryFieldId]: 'Initial',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox(2);

      const updateRecordResponse = await fetch(`${baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          recordId,
          fields: {
            [primaryFieldId]: 'Updated',
          },
        }),
      });
      expect(updateRecordResponse.status).toBe(200);
      const updateRaw = await updateRecordResponse.json();
      const updateParsed = updateRecordOkResponseSchema.safeParse(updateRaw);
      expect(updateParsed.success).toBe(true);
      if (!updateParsed.success || !updateParsed.data.ok) return;

      await processOutbox(2);

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const lastModifiedAt = record.fields[lastModifiedTimeFieldId];
      expect(typeof lastModifiedAt).toBe('string');
      if (typeof lastModifiedAt !== 'string') return;

      const expectedDate = new Date(lastModifiedAt).toISOString().slice(0, 10);
      expect(record.fields[formulaFieldId]).toBe(expectedDate);
    });
  });

  // ============================================================================
  // 3. 二元运算符类型强制转换
  // ============================================================================
  describe('binary operator coercion', () => {
    /**
     * 测试场景：数字和字符串相加时的类型转换
     * 公式：{numberField} & "text"
     * 预期：数字转换为字符串后拼接
     */
    it('should coerce number to string when concatenating - {numberField} & "text"', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('Concat Coercion Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Concat Result',
            options: {
              expression: `{${numberFieldId}} & "text"`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Concat Result')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 123,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('123.00text');
    });

    /**
     * 测试场景：字符串数字相加
     * 公式："10" + {numberField}
     * 预期：字符串 "10" 转换为数字后相加
     */
    it('should coerce string to number when adding - "10" + {numberField}', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('Add Coercion Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Add Result',
            options: {
              expression: `"10" + {${numberFieldId}}`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Add Result')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 5,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('105.00');
    });

    /**
     * 测试场景：布尔值与数字运算
     * 公式：{checkboxField} + 1
     * 预期：true 转换为 1，false 转换为 0
     */
    it('should coerce boolean to number - {checkboxField} + 1', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('Boolean Coercion Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'checkbox', name: 'Flag' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const checkboxFieldId = table.fields.find((f) => f.name === 'Flag')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Bool Plus One',
            options: {
              expression: `{${checkboxFieldId}} + 1`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Bool Plus One')?.id ?? '';

      const trueRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [primaryFieldId]: 'True',
            [checkboxFieldId]: true,
          },
        }),
      });
      expect(trueRecord.status).toBe(201);
      const trueRaw = await trueRecord.json();
      const trueParsed = createRecordOkResponseSchema.safeParse(trueRaw);
      expect(trueParsed.success).toBe(true);
      if (!trueParsed.success || !trueParsed.data.ok) return;
      const trueRecordId = trueParsed.data.data.record.id;

      const falseRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [primaryFieldId]: 'False',
            [checkboxFieldId]: false,
          },
        }),
      });
      expect(falseRecord.status).toBe(201);
      const falseRaw = await falseRecord.json();
      const falseParsed = createRecordOkResponseSchema.safeParse(falseRaw);
      expect(falseParsed.success).toBe(true);
      if (!falseParsed.success || !falseParsed.data.ok) return;
      const falseRecordId = falseParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const trueRecordResult = records.find((r) => r.id === trueRecordId);
      const falseRecordResult = records.find((r) => r.id === falseRecordId);

      expect(trueRecordResult).toBeDefined();
      expect(falseRecordResult).toBeDefined();
      if (!trueRecordResult || !falseRecordResult) return;

      expect(trueRecordResult.fields[formulaFieldId]).toBe('true1');
      expect(falseRecordResult.fields[formulaFieldId]).toBe('false1');
    });

    /**
     * 测试场景：数字字段使用 SUBSTITUTE 函数（数字自动转字符串）
     * 公式：SUBSTITUTE({numberField}, "0", "X")
     * 预期：数字转换为字符串后进行替换
     */
    it('should substitute numeric field as text - SUBSTITUTE({numberField}, "0", "X")', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('Numeric Substitute Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Subbed',
            options: {
              expression: `SUBSTITUTE({${numberFieldId}}, "0", "X")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Subbed')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [primaryFieldId]: 'Row 1',
            [numberFieldId]: 1000,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('1XXX.XX');
    });
  });

  // ============================================================================
  // 4. 布尔运算符组合
  // ============================================================================
  describe('boolean operator combinations', () => {
    /**
     * 测试场景：AND 运算符
     * 公式：AND({checkbox1}, {checkbox2})
     * 预期：两个都为 true 时返回 true
     */
    it('should evaluate AND operator - AND({checkbox1}, {checkbox2})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('AND Checkbox Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'checkbox', name: 'A' },
            { type: 'checkbox', name: 'B' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const aFieldId = table.fields.find((f) => f.name === 'A')?.id ?? '';
      const bFieldId = table.fields.find((f) => f.name === 'B')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'A And B',
            options: {
              expression: `AND({${aFieldId}}, {${bFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'A And B')?.id ?? '';

      const trueRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'TT', [aFieldId]: true, [bFieldId]: true },
        }),
      });
      expect(trueRecord.status).toBe(201);
      const trueRaw = await trueRecord.json();
      const trueParsed = createRecordOkResponseSchema.safeParse(trueRaw);
      expect(trueParsed.success).toBe(true);
      if (!trueParsed.success || !trueParsed.data.ok) return;
      const trueRecordId = trueParsed.data.data.record.id;

      const falseRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'TF', [aFieldId]: true, [bFieldId]: false },
        }),
      });
      expect(falseRecord.status).toBe(201);
      const falseRaw = await falseRecord.json();
      const falseParsed = createRecordOkResponseSchema.safeParse(falseRaw);
      expect(falseParsed.success).toBe(true);
      if (!falseParsed.success || !falseParsed.data.ok) return;
      const falseRecordId = falseParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const trueRecordResult = records.find((r) => r.id === trueRecordId);
      const falseRecordResult = records.find((r) => r.id === falseRecordId);

      expect(trueRecordResult).toBeDefined();
      expect(falseRecordResult).toBeDefined();
      if (!trueRecordResult || !falseRecordResult) return;

      expect(trueRecordResult.fields[formulaFieldId]).toBe(true);
      expect(falseRecordResult.fields[formulaFieldId]).toBe(false);
    });

    /**
     * 测试场景：OR 运算符
     * 公式：OR({checkbox1}, {checkbox2})
     * 预期：任一为 true 时返回 true
     */
    it('should evaluate OR operator - OR({checkbox1}, {checkbox2})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('OR Checkbox Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'checkbox', name: 'A' },
            { type: 'checkbox', name: 'B' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const aFieldId = table.fields.find((f) => f.name === 'A')?.id ?? '';
      const bFieldId = table.fields.find((f) => f.name === 'B')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'A Or B',
            options: {
              expression: `OR({${aFieldId}}, {${bFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'A Or B')?.id ?? '';

      const trueRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'FT', [aFieldId]: false, [bFieldId]: true },
        }),
      });
      expect(trueRecord.status).toBe(201);
      const trueRaw = await trueRecord.json();
      const trueParsed = createRecordOkResponseSchema.safeParse(trueRaw);
      expect(trueParsed.success).toBe(true);
      if (!trueParsed.success || !trueParsed.data.ok) return;
      const trueRecordId = trueParsed.data.data.record.id;

      const falseRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'FF', [aFieldId]: false, [bFieldId]: false },
        }),
      });
      expect(falseRecord.status).toBe(201);
      const falseRaw = await falseRecord.json();
      const falseParsed = createRecordOkResponseSchema.safeParse(falseRaw);
      expect(falseParsed.success).toBe(true);
      if (!falseParsed.success || !falseParsed.data.ok) return;
      const falseRecordId = falseParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const trueRecordResult = records.find((r) => r.id === trueRecordId);
      const falseRecordResult = records.find((r) => r.id === falseRecordId);

      expect(trueRecordResult).toBeDefined();
      expect(falseRecordResult).toBeDefined();
      if (!trueRecordResult || !falseRecordResult) return;

      expect(trueRecordResult.fields[formulaFieldId]).toBe(true);
      expect(falseRecordResult.fields[formulaFieldId]).toBe(false);
    });

    /**
     * 测试场景：NOT 运算符
     * 公式：NOT({checkboxField})
     * 预期：取反
     */
    it('should evaluate NOT operator - NOT({checkboxField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('NOT Checkbox Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'checkbox', name: 'A' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const aFieldId = table.fields.find((f) => f.name === 'A')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Not A',
            options: {
              expression: `NOT({${aFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Not A')?.id ?? '';

      const falseRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'A=true', [aFieldId]: true },
        }),
      });
      expect(falseRecord.status).toBe(201);
      const falseRaw = await falseRecord.json();
      const falseParsed = createRecordOkResponseSchema.safeParse(falseRaw);
      expect(falseParsed.success).toBe(true);
      if (!falseParsed.success || !falseParsed.data.ok) return;
      const falseRecordId = falseParsed.data.data.record.id;

      const trueRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'A=false', [aFieldId]: false },
        }),
      });
      expect(trueRecord.status).toBe(201);
      const trueRaw = await trueRecord.json();
      const trueParsed = createRecordOkResponseSchema.safeParse(trueRaw);
      expect(trueParsed.success).toBe(true);
      if (!trueParsed.success || !trueParsed.data.ok) return;
      const trueRecordId = trueParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const falseRecordResult = records.find((r) => r.id === falseRecordId);
      const trueRecordResult = records.find((r) => r.id === trueRecordId);

      expect(falseRecordResult).toBeDefined();
      expect(trueRecordResult).toBeDefined();
      if (!falseRecordResult || !trueRecordResult) return;

      expect(falseRecordResult.fields[formulaFieldId]).toBe(false);
      expect(trueRecordResult.fields[formulaFieldId]).toBe(true);
    });

    /**
     * 测试场景：复杂布尔组合
     * 公式：AND(OR({a}, {b}), NOT({c}))
     * 预期：复杂逻辑组合正确计算
     */
    it('should evaluate complex boolean combination - AND(OR({a}, {b}), NOT({c}))', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('Complex Boolean Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'checkbox', name: 'A' },
            { type: 'checkbox', name: 'B' },
            { type: 'checkbox', name: 'C' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const aFieldId = table.fields.find((f) => f.name === 'A')?.id ?? '';
      const bFieldId = table.fields.find((f) => f.name === 'B')?.id ?? '';
      const cFieldId = table.fields.find((f) => f.name === 'C')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Complex',
            options: {
              expression: `AND(OR({${aFieldId}}, {${bFieldId}}), NOT({${cFieldId}}))`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Complex')?.id ?? '';

      const trueRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'T', [aFieldId]: true, [bFieldId]: false, [cFieldId]: false },
        }),
      });
      expect(trueRecord.status).toBe(201);
      const trueRaw = await trueRecord.json();
      const trueParsed = createRecordOkResponseSchema.safeParse(trueRaw);
      expect(trueParsed.success).toBe(true);
      if (!trueParsed.success || !trueParsed.data.ok) return;
      const trueRecordId = trueParsed.data.data.record.id;

      const falseRecord1 = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [primaryFieldId]: 'F1',
            [aFieldId]: false,
            [bFieldId]: false,
            [cFieldId]: false,
          },
        }),
      });
      expect(falseRecord1.status).toBe(201);
      const falseRaw1 = await falseRecord1.json();
      const falseParsed1 = createRecordOkResponseSchema.safeParse(falseRaw1);
      expect(falseParsed1.success).toBe(true);
      if (!falseParsed1.success || !falseParsed1.data.ok) return;
      const falseRecordId1 = falseParsed1.data.data.record.id;

      const falseRecord2 = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'F2', [aFieldId]: true, [bFieldId]: false, [cFieldId]: true },
        }),
      });
      expect(falseRecord2.status).toBe(201);
      const falseRaw2 = await falseRecord2.json();
      const falseParsed2 = createRecordOkResponseSchema.safeParse(falseRaw2);
      expect(falseParsed2.success).toBe(true);
      if (!falseParsed2.success || !falseParsed2.data.ok) return;
      const falseRecordId2 = falseParsed2.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const trueRecordResult = records.find((r) => r.id === trueRecordId);
      const falseRecordResult1 = records.find((r) => r.id === falseRecordId1);
      const falseRecordResult2 = records.find((r) => r.id === falseRecordId2);

      expect(trueRecordResult).toBeDefined();
      expect(falseRecordResult1).toBeDefined();
      expect(falseRecordResult2).toBeDefined();
      if (!trueRecordResult || !falseRecordResult1 || !falseRecordResult2) return;

      expect(trueRecordResult.fields[formulaFieldId]).toBe(true);
      expect(falseRecordResult1.fields[formulaFieldId]).toBe(false);
      expect(falseRecordResult2.fields[formulaFieldId]).toBe(false);
    });

    /**
     * 测试场景：空值的布尔真值性
     * 公式：IF({textField}, "truthy", "falsy")
     * 预期：空字符串为 falsy，非空为 truthy
     */
    it('should handle truthiness of empty values - IF({textField}, "truthy", "falsy")', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('Empty Truthiness Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', name: 'Text' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Truthy',
            options: {
              expression: `IF({${textFieldId}}, "truthy", "falsy")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Truthy')?.id ?? '';

      const emptyRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Empty', [textFieldId]: '' },
        }),
      });
      expect(emptyRecord.status).toBe(201);
      const emptyRaw = await emptyRecord.json();
      const emptyParsed = createRecordOkResponseSchema.safeParse(emptyRaw);
      expect(emptyParsed.success).toBe(true);
      if (!emptyParsed.success || !emptyParsed.data.ok) return;
      const emptyRecordId = emptyParsed.data.data.record.id;

      const filledRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Filled', [textFieldId]: 'Hello' },
        }),
      });
      expect(filledRecord.status).toBe(201);
      const filledRaw = await filledRecord.json();
      const filledParsed = createRecordOkResponseSchema.safeParse(filledRaw);
      expect(filledParsed.success).toBe(true);
      if (!filledParsed.success || !filledParsed.data.ok) return;
      const filledRecordId = filledParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const emptyRecordResult = records.find((r) => r.id === emptyRecordId);
      const filledRecordResult = records.find((r) => r.id === filledRecordId);

      expect(emptyRecordResult).toBeDefined();
      expect(filledRecordResult).toBeDefined();
      if (!emptyRecordResult || !filledRecordResult) return;

      expect(emptyRecordResult.fields[formulaFieldId]).toBe('falsy');
      expect(filledRecordResult.fields[formulaFieldId]).toBe('truthy');
    });

    /**
     * 测试场景：数字零的布尔真值性
     * 公式：IF({numberField}, "truthy", "falsy")
     * 预期：0 为 falsy，非零为 truthy
     */
    it('should handle truthiness of zero - IF({numberField}, "truthy", "falsy")', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('Zero Truthiness Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Truthy',
            options: {
              expression: `IF({${numberFieldId}}, "truthy", "falsy")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Truthy')?.id ?? '';

      const zeroRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Zero', [numberFieldId]: 0 },
        }),
      });
      expect(zeroRecord.status).toBe(201);
      const zeroRaw = await zeroRecord.json();
      const zeroParsed = createRecordOkResponseSchema.safeParse(zeroRaw);
      expect(zeroParsed.success).toBe(true);
      if (!zeroParsed.success || !zeroParsed.data.ok) return;
      const zeroRecordId = zeroParsed.data.data.record.id;

      const nonZeroRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'NonZero', [numberFieldId]: 5 },
        }),
      });
      expect(nonZeroRecord.status).toBe(201);
      const nonZeroRaw = await nonZeroRecord.json();
      const nonZeroParsed = createRecordOkResponseSchema.safeParse(nonZeroRaw);
      expect(nonZeroParsed.success).toBe(true);
      if (!nonZeroParsed.success || !nonZeroParsed.data.ok) return;
      const nonZeroRecordId = nonZeroParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const zeroRecordResult = records.find((r) => r.id === zeroRecordId);
      const nonZeroRecordResult = records.find((r) => r.id === nonZeroRecordId);

      expect(zeroRecordResult).toBeDefined();
      expect(nonZeroRecordResult).toBeDefined();
      if (!zeroRecordResult || !nonZeroRecordResult) return;

      expect(zeroRecordResult.fields[formulaFieldId]).toBe('falsy');
      expect(nonZeroRecordResult.fields[formulaFieldId]).toBe('truthy');
    });
  });

  // ============================================================================
  // 5. LAST_MODIFIED_TIME 带字段参数
  // ============================================================================
  describe('LAST_MODIFIED_TIME with field parameters', () => {
    /**
     * 测试场景：LAST_MODIFIED_TIME 追踪特定字段
     * 字段配置：trackedFieldIds: [numberFieldId]
     * 预期：只有被追踪的字段更新时才更新时间
     */
    it('should track specific field changes with LAST_MODIFIED_TIME', async () => {
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('LMT Track Single Field Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Amount' },
            { type: 'singleLineText', name: 'Notes' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const amountFieldId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';

      const createLastModifiedResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'lastModifiedTime',
            name: 'Tracked LMT',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
              trackedFieldIds: [amountFieldId],
            },
          },
        }),
      });
      expect(createLastModifiedResponse.status).toBe(200);
      const lastModifiedRaw = await createLastModifiedResponse.json();
      const lastModifiedParsed = createFieldOkResponseSchema.safeParse(lastModifiedRaw);
      expect(lastModifiedParsed.success).toBe(true);
      if (!lastModifiedParsed.success || !lastModifiedParsed.data.ok) return;

      const lastModifiedFieldId =
        lastModifiedParsed.data.data.table.fields.find((f) => f.name === 'Tracked LMT')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Row 1', [amountFieldId]: 1 },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox(2);

      let records = await listRecords(table.id);
      let record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const initial = record.fields[lastModifiedFieldId];
      expect(typeof initial).toBe('string');
      if (typeof initial !== 'string') return;

      await sleep(20);

      const updateRecordResponse = await fetch(`${baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          recordId,
          fields: { [amountFieldId]: 2 },
        }),
      });
      expect(updateRecordResponse.status).toBe(200);
      const updateRaw = await updateRecordResponse.json();
      const updateParsed = updateRecordOkResponseSchema.safeParse(updateRaw);
      expect(updateParsed.success).toBe(true);
      if (!updateParsed.success || !updateParsed.data.ok) return;

      await processOutbox(2);

      records = await listRecords(table.id);
      record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const after = record.fields[lastModifiedFieldId];
      expect(typeof after).toBe('string');
      if (typeof after !== 'string') return;

      expect(after).not.toBe(initial);
      expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(initial).getTime());
    });

    /**
     * 测试场景：LAST_MODIFIED_TIME 追踪多个字段
     * 字段配置：trackedFieldIds: [field1Id, field2Id]
     * 预期：任一被追踪字段更新时更新时间
     */
    it('should track multiple field changes with LAST_MODIFIED_TIME', async () => {
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('LMT Track Multiple Fields Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Amount' },
            { type: 'singleLineText', name: 'Notes' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const amountFieldId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';
      const notesFieldId = table.fields.find((f) => f.name === 'Notes')?.id ?? '';

      const createLastModifiedResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'lastModifiedTime',
            name: 'Tracked LMT',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
              trackedFieldIds: [amountFieldId, notesFieldId],
            },
          },
        }),
      });
      expect(createLastModifiedResponse.status).toBe(200);
      const lastModifiedRaw = await createLastModifiedResponse.json();
      const lastModifiedParsed = createFieldOkResponseSchema.safeParse(lastModifiedRaw);
      expect(lastModifiedParsed.success).toBe(true);
      if (!lastModifiedParsed.success || !lastModifiedParsed.data.ok) return;

      const lastModifiedFieldId =
        lastModifiedParsed.data.data.table.fields.find((f) => f.name === 'Tracked LMT')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Row 1', [amountFieldId]: 1, [notesFieldId]: 'a' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox(2);

      let records = await listRecords(table.id);
      let record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const initial = record.fields[lastModifiedFieldId];
      expect(typeof initial).toBe('string');
      if (typeof initial !== 'string') return;

      await sleep(20);

      const updateRecordResponse = await fetch(`${baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          recordId,
          fields: { [notesFieldId]: 'b' },
        }),
      });
      expect(updateRecordResponse.status).toBe(200);
      const updateRaw = await updateRecordResponse.json();
      const updateParsed = updateRecordOkResponseSchema.safeParse(updateRaw);
      expect(updateParsed.success).toBe(true);
      if (!updateParsed.success || !updateParsed.data.ok) return;

      await processOutbox(2);

      records = await listRecords(table.id);
      record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const after = record.fields[lastModifiedFieldId];
      expect(typeof after).toBe('string');
      if (typeof after !== 'string') return;

      expect(after).not.toBe(initial);
      expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(initial).getTime());
    });

    /**
     * 测试场景：未追踪字段更新不影响 LAST_MODIFIED_TIME
     * 预期：更新未追踪字段时，LAST_MODIFIED_TIME 不变
     */
    it('should not update LAST_MODIFIED_TIME when untracked field changes', async () => {
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('LMT Untracked Field Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Amount' },
            { type: 'singleLineText', name: 'Notes' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const amountFieldId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';
      const notesFieldId = table.fields.find((f) => f.name === 'Notes')?.id ?? '';

      const createLastModifiedResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'lastModifiedTime',
            name: 'Tracked LMT',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
              trackedFieldIds: [amountFieldId],
            },
          },
        }),
      });
      expect(createLastModifiedResponse.status).toBe(200);
      const lastModifiedRaw = await createLastModifiedResponse.json();
      const lastModifiedParsed = createFieldOkResponseSchema.safeParse(lastModifiedRaw);
      expect(lastModifiedParsed.success).toBe(true);
      if (!lastModifiedParsed.success || !lastModifiedParsed.data.ok) return;

      const lastModifiedFieldId =
        lastModifiedParsed.data.data.table.fields.find((f) => f.name === 'Tracked LMT')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Row 1', [amountFieldId]: 1, [notesFieldId]: 'a' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox(2);

      let records = await listRecords(table.id);
      let record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const initial = record.fields[lastModifiedFieldId];
      expect(typeof initial).toBe('string');
      if (typeof initial !== 'string') return;

      await sleep(20);

      const updateRecordResponse = await fetch(`${baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          recordId,
          fields: { [notesFieldId]: 'b' },
        }),
      });
      expect(updateRecordResponse.status).toBe(200);
      const updateRaw = await updateRecordResponse.json();
      const updateParsed = updateRecordOkResponseSchema.safeParse(updateRaw);
      expect(updateParsed.success).toBe(true);
      if (!updateParsed.success || !updateParsed.data.ok) return;

      await processOutbox(2);

      records = await listRecords(table.id);
      record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const after = record.fields[lastModifiedFieldId];
      expect(typeof after).toBe('string');
      if (typeof after !== 'string') return;

      expect(after).toBe(initial);
    });
  });

  // ============================================================================
  // 6. 数值函数
  // ============================================================================
  describe('numeric functions', () => {
    /**
     * 测试场景：ROUND 函数
     * 公式：ROUND({numberField}, 2)
     * 预期：四舍五入到2位小数
     */
    it('should round number - ROUND({numberField}, 2)', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'Round Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Rounded',
            options: {
              expression: `ROUND({${numberFieldId}}, 2)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Rounded')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 3.14159,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(3.14); // 四舍五入到2位小数
    });

    /**
     * 测试场景：CEILING 函数
     * 公式：CEILING({numberField})
     * 预期：向上取整
     */
    it('should ceiling number - CEILING({numberField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'Ceiling Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Ceiling Value',
            options: {
              expression: `CEILING({${numberFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Ceiling Value')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 3.2,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(4); // CEILING(3.2) = 4
    });

    /**
     * 测试场景：FLOOR 函数
     * 公式：FLOOR({numberField})
     * 预期：向下取整
     */
    it('should floor number - FLOOR({numberField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'Floor Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Floor Value',
            options: {
              expression: `FLOOR({${numberFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Floor Value')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 3.8,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(3); // FLOOR(3.8) = 3
    });

    /**
     * 测试场景：ABS 函数
     * 公式：ABS({numberField})
     * 预期：返回绝对值
     */
    it('should get absolute value - ABS({numberField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'ABS Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Absolute Value',
            options: {
              expression: `ABS({${numberFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Absolute Value')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: -15.5,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(15.5); // ABS(-15.5) = 15.5
    });

    /**
     * 测试场景：SQRT 函数
     * 公式：SQRT({numberField})
     * 预期：返回平方根
     */
    it('should get square root - SQRT({numberField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'SQRT Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Square Root',
            options: {
              expression: `SQRT({${numberFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Square Root')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 16,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(4); // SQRT(16) = 4
    });

    /**
     * 测试场景：POWER 函数
     * 公式：POWER({numberField}, 2)
     * 预期：返回幂
     */
    it('should get power - POWER({numberField}, 2)', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'POWER Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Power Result',
            options: {
              expression: `POWER({${numberFieldId}}, 2)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Power Result')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 5,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(25); // POWER(5, 2) = 25
    });

    /**
     * 测试场景：MOD 函数
     * 公式：MOD({numberField}, 3)
     * 预期：返回模
     */
    it('should get modulo - MOD({numberField}, 3)', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'MOD Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Mod Result',
            options: {
              expression: `MOD({${numberFieldId}}, 3)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Mod Result')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 10,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(1); // MOD(10, 3) = 1
    });

    /**
     * 测试场景：MAX 函数
     * 公式：MAX({num1}, {num2}, {num3})
     * 预期：返回最大值
     */
    it('should get max value - MAX({num1}, {num2}, {num3})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'MAX Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Num1' },
            { type: 'number', name: 'Num2' },
            { type: 'number', name: 'Num3' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const num1FieldId = table.fields.find((f) => f.name === 'Num1')?.id ?? '';
      const num2FieldId = table.fields.find((f) => f.name === 'Num2')?.id ?? '';
      const num3FieldId = table.fields.find((f) => f.name === 'Num3')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Max Result',
            options: {
              expression: `MAX({${num1FieldId}}, {${num2FieldId}}, {${num3FieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Max Result')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [num1FieldId]: 5,
            [num2FieldId]: 15,
            [num3FieldId]: 10,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(15); // MAX(5, 15, 10) = 15
    });

    /**
     * 测试场景：MIN 函数
     * 公式：MIN({num1}, {num2}, {num3})
     * 预期：返回最小值
     */
    it('should get min value - MIN({num1}, {num2}, {num3})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'MIN Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Num1' },
            { type: 'number', name: 'Num2' },
            { type: 'number', name: 'Num3' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const num1FieldId = table.fields.find((f) => f.name === 'Num1')?.id ?? '';
      const num2FieldId = table.fields.find((f) => f.name === 'Num2')?.id ?? '';
      const num3FieldId = table.fields.find((f) => f.name === 'Num3')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Min Result',
            options: {
              expression: `MIN({${num1FieldId}}, {${num2FieldId}}, {${num3FieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Min Result')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [num1FieldId]: 5,
            [num2FieldId]: 15,
            [num3FieldId]: 10,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(5); // MIN(5, 15, 10) = 5
    });

    /**
     * 测试场景：SUM 函数
     * 公式：SUM({num1}, {num2}, {num3})
     * 预期：返回总和
     */
    it('should get sum - SUM({num1}, {num2}, {num3})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'SUM Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Num1' },
            { type: 'number', name: 'Num2' },
            { type: 'number', name: 'Num3' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const num1FieldId = table.fields.find((f) => f.name === 'Num1')?.id ?? '';
      const num2FieldId = table.fields.find((f) => f.name === 'Num2')?.id ?? '';
      const num3FieldId = table.fields.find((f) => f.name === 'Num3')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Sum Result',
            options: {
              expression: `SUM({${num1FieldId}}, {${num2FieldId}}, {${num3FieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Sum Result')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [num1FieldId]: 5,
            [num2FieldId]: 15,
            [num3FieldId]: 10,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(30); // SUM(5, 15, 10) = 30
    });

    /**
     * 测试场景：AVERAGE 函数
     * 公式：AVERAGE({num1}, {num2}, {num3})
     * 预期：返回平均值
     */
    it('should get average - AVERAGE({num1}, {num2}, {num3})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'AVERAGE Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Num1' },
            { type: 'number', name: 'Num2' },
            { type: 'number', name: 'Num3' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const num1FieldId = table.fields.find((f) => f.name === 'Num1')?.id ?? '';
      const num2FieldId = table.fields.find((f) => f.name === 'Num2')?.id ?? '';
      const num3FieldId = table.fields.find((f) => f.name === 'Num3')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Average Result',
            options: {
              expression: `AVERAGE({${num1FieldId}}, {${num2FieldId}}, {${num3FieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Average Result')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [num1FieldId]: 6,
            [num2FieldId]: 12,
            [num3FieldId]: 9,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(9); // AVERAGE(6, 12, 9) = 9
    });

    /**
     * 测试场景：VALUE 函数（字符串转数字）
     * 公式：VALUE({textField})
     * 预期：将字符串 "123" 转换为数字 123
     */
    it('should convert string to number - VALUE({textField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'VALUE Test',
          fields: [{ type: 'singleLineText', name: 'NumStr', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'NumStr')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Parsed Value',
            options: {
              expression: `VALUE({${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Parsed Value')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: '123',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(123); // VALUE("123") = 123
    });

    /**
     * 测试场景：INT 函数
     * 公式：INT({numberField})
     * 预期：返回整数部分
     */
    it('should get integer part - INT({numberField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'INT Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Int Value',
            options: {
              expression: `INT({${numberFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Int Value')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 7.89,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(7); // INT(7.89) = 7
    });

    /**
     * 测试场景：EVEN 函数
     * 公式：EVEN({numberField})
     * 预期：向上取到最近的偶数
     */
    it('should round up to even - EVEN({numberField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'EVEN Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Even Value',
            options: {
              expression: `EVEN({${numberFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Even Value')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 3.2,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(4); // EVEN(3.2) = 4
    });

    /**
     * 测试场景：ODD 函数
     * 公式：ODD({numberField})
     * 预期：向上取到最近的奇数
     */
    it('should round up to odd - ODD({numberField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'ODD Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Odd Value',
            options: {
              expression: `ODD({${numberFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Odd Value')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 2.5,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(3); // ODD(2.5) = 3
    });

    /**
     * 测试场景：LOG 函数
     * 公式：LOG({numberField}, 10)
     * 预期：返回以10为底的对数
     */
    it('should get log - LOG({numberField}, 10)', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'LOG Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Log Value',
            options: {
              expression: `LOG({${numberFieldId}}, 10)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Log Value')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 100,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(2); // LOG(100, 10) = 2
    });

    /**
     * 测试场景：EXP 函数
     * 公式：EXP({numberField})
     * 预期：返回 e 的幂
     */
    it('should get exp - EXP({numberField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'EXP Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Exp Value',
            options: {
              expression: `EXP({${numberFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Exp Value')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 1,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      // EXP(1) = e ≈ 2.718281828...
      const result = record.fields[formulaFieldId] as number;
      expect(result).toBeCloseTo(Math.E, 10);
    });
  });

  // ============================================================================
  // 7. 文本函数
  // ============================================================================
  describe('text functions', () => {
    /**
     * 测试场景：CONCATENATE 函数
     * 公式：CONCATENATE({text1}, " ", {text2})
     * 预期：拼接文本
     */
    it('should concatenate text - CONCATENATE({text1}, " ", {text2})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'Concat Test',
          fields: [
            { type: 'singleLineText', name: 'FirstName', isPrimary: true },
            { type: 'singleLineText', name: 'LastName' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const firstNameFieldId = table.fields.find((f) => f.name === 'FirstName')?.id ?? '';
      const lastNameFieldId = table.fields.find((f) => f.name === 'LastName')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'FullName',
            options: {
              expression: `CONCATENATE({${firstNameFieldId}}, " ", {${lastNameFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'FullName')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [firstNameFieldId]: 'John',
            [lastNameFieldId]: 'Doe',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('John Doe');
    });

    /**
     * 测试场景：& 运算符拼接
     * 公式：{text1} & " - " & {text2}
     * 预期：使用 & 拼接文本
     */
    it('should concatenate with & operator - {text1} & " - " & {text2}', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('Ampersand Concat Test'),
          fields: [
            { type: 'singleLineText', name: 'Text1', isPrimary: true },
            { type: 'singleLineText', name: 'Text2' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const text1FieldId = table.fields.find((f) => f.name === 'Text1')?.id ?? '';
      const text2FieldId = table.fields.find((f) => f.name === 'Text2')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Joined',
            options: {
              expression: `{${text1FieldId}} & " - " & {${text2FieldId}}`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Joined')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [text1FieldId]: 'Hello', [text2FieldId]: 'World' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('Hello - World');
    });

    /**
     * 测试场景：LEFT 函数
     * 公式：LEFT({textField}, 5)
     * 预期：返回左边5个字符
     */
    it('should get left characters - LEFT({textField}, 5)', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'Left Test',
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Left Five',
            options: {
              expression: `LEFT({${textFieldId}}, 5)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Left Five')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: 'Hello World',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('Hello'); // LEFT("Hello World", 5) = "Hello"
    });

    /**
     * 测试场景：RIGHT 函数
     * 公式：RIGHT({textField}, 5)
     * 预期：返回右边5个字符
     */
    it('should get right characters - RIGHT({textField}, 5)', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'Right Test',
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Right Five',
            options: {
              expression: `RIGHT({${textFieldId}}, 5)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Right Five')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: 'Hello World',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('World'); // RIGHT("Hello World", 5) = "World"
    });

    /**
     * 测试场景：MID 函数
     * 公式：MID({textField}, 2, 3)
     * 预期：从第2个字符开始取3个字符
     */
    it('should get mid characters - MID({textField}, 2, 3)', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'MID Test',
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Mid Result',
            options: {
              expression: `MID({${textFieldId}}, 2, 3)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Mid Result')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: 'Hello World',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('ell'); // MID("Hello World", 2, 3) = "ell"
    });

    /**
     * 测试场景：LEN 函数
     * 公式：LEN({textField})
     * 预期：返回文本长度
     */
    it('should get text length - LEN({textField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'LEN Test',
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Text Length',
            options: {
              expression: `LEN({${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Text Length')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: 'Hello World',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(11); // LEN("Hello World") = 11
    });

    /**
     * 测试场景：UPPER 函数
     * 公式：UPPER({textField})
     * 预期：转换为大写
     */
    it('should convert to upper case - UPPER({textField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'UPPER Test',
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Upper Text',
            options: {
              expression: `UPPER({${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Upper Text')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: 'hello world',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('HELLO WORLD');
    });

    /**
     * 测试场景：LOWER 函数
     * 公式：LOWER({textField})
     * 预期：转换为小写
     */
    it('should convert to lower case - LOWER({textField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'LOWER Test',
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Lower Text',
            options: {
              expression: `LOWER({${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Lower Text')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: 'HELLO WORLD',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('hello world');
    });

    /**
     * 测试场景：TRIM 函数
     * 公式：TRIM({textField})
     * 预期：去除首尾空格
     */
    it('should trim whitespace - TRIM({textField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'TRIM Test',
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Trimmed Text',
            options: {
              expression: `TRIM({${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Trimmed Text')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [textFieldId]: '  Hello World  ',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('Hello World');
    });

    /**
     * 测试场景：REPLACE 函数
     * 公式：REPLACE({textField}, 1, 3, "NEW")
     * 预期：从位置1开始替换3个字符为 "NEW"
     */
    it('should replace text - REPLACE({textField}, 1, 3, "NEW")', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('REPLACE Test'),
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Replaced',
            options: {
              expression: `REPLACE({${textFieldId}}, 1, 3, "NEW")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Replaced')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [textFieldId]: 'abcdef' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('NEWdef');
    });

    /**
     * 测试场景：SUBSTITUTE 函数
     * 公式：SUBSTITUTE({textField}, "old", "new")
     * 预期：将 "old" 替换为 "new"
     */
    it('should substitute text - SUBSTITUTE({textField}, "old", "new")', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('SUBSTITUTE Text Test'),
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Subbed',
            options: {
              expression: `SUBSTITUTE({${textFieldId}}, "old", "new")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Subbed')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [textFieldId]: 'old-old' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('new-new');
    });

    /**
     * 测试场景：FIND 函数
     * 公式：FIND("abc", {textField})
     * 预期：返回子串位置
     */
    it('should find substring position - FIND("abc", {textField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('FIND Test'),
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Pos',
            options: {
              expression: `FIND("abc", {${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Pos')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [textFieldId]: 'xxabcxx' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(3);
    });

    /**
     * 测试场景：SEARCH 函数（不区分大小写）
     * 公式：SEARCH("ABC", {textField})
     * 预期：不区分大小写查找子串位置
     */
    it('should search substring case-insensitive - SEARCH("ABC", {textField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('SEARCH Test'),
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Pos',
            options: {
              expression: `SEARCH("ABC", {${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Pos')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [textFieldId]: 'xxabcxx' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(3);
    });

    /**
     * 测试场景：REPT 函数
     * 公式：REPT({textField}, 3)
     * 预期：重复文本3次
     */
    it('should repeat text - REPT({textField}, 3)', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('REPT Test'),
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Repeated',
            options: {
              expression: `REPT({${textFieldId}}, 3)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Repeated')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [textFieldId]: 'ab' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('ababab');
    });

    /**
     * 测试场景：T 函数
     * 公式：T({numberField})
     * 预期：如果是文本返回文本，否则返回空字符串
     */
    it('should convert to text or empty - T({numberField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('T Function Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'AsText',
            options: {
              expression: `T({${numberFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'AsText')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Row 1', [numberFieldId]: 123 },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(null);
    });

    /**
     * 测试场景：ENCODE_URL_COMPONENT 函数
     * 公式：ENCODE_URL_COMPONENT({textField})
     * 预期：URL 编码文本
     */
    it('should encode url component - ENCODE_URL_COMPONENT({textField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('ENCODE_URL_COMPONENT Test'),
          fields: [{ type: 'singleLineText', name: 'Text', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Encoded',
            options: {
              expression: `ENCODE_URL_COMPONENT({${textFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Encoded')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [textFieldId]: 'Hello World' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('Hello World');
    });
  });

  // ============================================================================
  // 8. 逻辑函数
  // ============================================================================
  describe('logical functions', () => {
    /**
     * 测试场景：IF 函数
     * 公式：IF({condition}, "yes", "no")
     * 预期：条件为真返回 "yes"，否则返回 "no"
     */
    it('should evaluate IF - IF({condition}, "yes", "no")', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'IF Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Score' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const scoreFieldId = table.fields.find((f) => f.name === 'Score')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'PassFail',
            options: {
              expression: `IF({${scoreFieldId}} >= 60, "Pass", "Fail")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'PassFail')?.id ?? '';

      // 测试及格情况
      const passRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [scoreFieldId]: 75 },
        }),
      });
      expect(passRecord.status).toBe(201);
      const passRaw = await passRecord.json();
      const passParsed = createRecordOkResponseSchema.safeParse(passRaw);
      expect(passParsed.success).toBe(true);
      if (!passParsed.success || !passParsed.data.ok) return;
      const passRecordId = passParsed.data.data.record.id;

      // 测试不及格情况
      const failRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [scoreFieldId]: 45 },
        }),
      });
      expect(failRecord.status).toBe(201);
      const failRaw = await failRecord.json();
      const failParsed = createRecordOkResponseSchema.safeParse(failRaw);
      expect(failParsed.success).toBe(true);
      if (!failParsed.success || !failParsed.data.ok) return;
      const failRecordId = failParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const passRecordResult = records.find((r) => r.id === passRecordId);
      const failRecordResult = records.find((r) => r.id === failRecordId);

      expect(passRecordResult).toBeDefined();
      expect(failRecordResult).toBeDefined();
      if (!passRecordResult || !failRecordResult) return;

      expect(passRecordResult.fields[formulaFieldId]).toBe('Pass');
      expect(failRecordResult.fields[formulaFieldId]).toBe('Fail');
    });

    /**
     * 测试场景：IF 嵌套
     * 公式：IF({a}, "A", IF({b}, "B", "C"))
     * 预期：嵌套条件正确计算
     */
    it('should evaluate nested IF - IF({a}, "A", IF({b}, "B", "C"))', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'Nested IF Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'checkbox', name: 'A' },
            { type: 'checkbox', name: 'B' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const aFieldId = table.fields.find((f) => f.name === 'A')?.id ?? '';
      const bFieldId = table.fields.find((f) => f.name === 'B')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Nested Result',
            options: {
              expression: `IF({${aFieldId}}, "A", IF({${bFieldId}}, "B", "C"))`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Nested Result')?.id ?? '';

      // 测试 a=true：应返回 "A"
      const aRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [aFieldId]: true, [bFieldId]: false },
        }),
      });
      expect(aRecord.status).toBe(201);
      const aRaw = await aRecord.json();
      const aParsed = createRecordOkResponseSchema.safeParse(aRaw);
      expect(aParsed.success).toBe(true);
      if (!aParsed.success || !aParsed.data.ok) return;
      const aRecordId = aParsed.data.data.record.id;

      // 测试 a=false, b=true：应返回 "B"
      const bRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [aFieldId]: false, [bFieldId]: true },
        }),
      });
      expect(bRecord.status).toBe(201);
      const bRaw = await bRecord.json();
      const bParsed = createRecordOkResponseSchema.safeParse(bRaw);
      expect(bParsed.success).toBe(true);
      if (!bParsed.success || !bParsed.data.ok) return;
      const bRecordId = bParsed.data.data.record.id;

      // 测试 a=false, b=false：应返回 "C"
      const cRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [aFieldId]: false, [bFieldId]: false },
        }),
      });
      expect(cRecord.status).toBe(201);
      const cRaw = await cRecord.json();
      const cParsed = createRecordOkResponseSchema.safeParse(cRaw);
      expect(cParsed.success).toBe(true);
      if (!cParsed.success || !cParsed.data.ok) return;
      const cRecordId = cParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const aRecordResult = records.find((r) => r.id === aRecordId);
      const bRecordResult = records.find((r) => r.id === bRecordId);
      const cRecordResult = records.find((r) => r.id === cRecordId);

      expect(aRecordResult).toBeDefined();
      expect(bRecordResult).toBeDefined();
      expect(cRecordResult).toBeDefined();
      if (!aRecordResult || !bRecordResult || !cRecordResult) return;

      expect(aRecordResult.fields[formulaFieldId]).toBe('A');
      expect(bRecordResult.fields[formulaFieldId]).toBe('B');
      expect(cRecordResult.fields[formulaFieldId]).toBe('C');
    });

    /**
     * 测试场景：SWITCH 函数
     * 公式：SWITCH({selectField}, "A", 1, "B", 2, 0)
     * 预期：根据值返回对应结果
     */
    it('should evaluate SWITCH - SWITCH({selectField}, "A", 1, "B", 2, 0)', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('SWITCH Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleSelect', name: 'Choice', options: ['A', 'B'] },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const selectField = table.fields.find((f) => f.name === 'Choice');
      const selectFieldId = selectField?.id ?? '';
      const choices =
        (selectField?.options as { choices?: Array<{ id: string; name: string }> })?.choices ?? [];
      const optionA = choices.find((choice) => choice.name === 'A');
      const optionB = choices.find((choice) => choice.name === 'B');
      if (!selectFieldId || !optionA?.id || !optionB?.id) {
        throw new Error('Missing select option metadata');
      }

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Mapped',
            options: {
              expression: `SWITCH({${selectFieldId}}, "A", 1, "B", 2, 0)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Mapped')?.id ?? '';

      const aRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'A', [selectFieldId]: optionA.id },
        }),
      });
      expect(aRecord.status).toBe(201);
      const aRaw = await aRecord.json();
      const aParsed = createRecordOkResponseSchema.safeParse(aRaw);
      expect(aParsed.success).toBe(true);
      if (!aParsed.success || !aParsed.data.ok) return;
      const aRecordId = aParsed.data.data.record.id;

      const bRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'B', [selectFieldId]: optionB.id },
        }),
      });
      expect(bRecord.status).toBe(201);
      const bRaw = await bRecord.json();
      const bParsed = createRecordOkResponseSchema.safeParse(bRaw);
      expect(bParsed.success).toBe(true);
      if (!bParsed.success || !bParsed.data.ok) return;
      const bRecordId = bParsed.data.data.record.id;

      const noneRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'None' },
        }),
      });
      expect(noneRecord.status).toBe(201);
      const noneRaw = await noneRecord.json();
      const noneParsed = createRecordOkResponseSchema.safeParse(noneRaw);
      expect(noneParsed.success).toBe(true);
      if (!noneParsed.success || !noneParsed.data.ok) return;
      const noneRecordId = noneParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const aRecordResult = records.find((r) => r.id === aRecordId);
      const bRecordResult = records.find((r) => r.id === bRecordId);
      const noneRecordResult = records.find((r) => r.id === noneRecordId);

      expect(aRecordResult).toBeDefined();
      expect(bRecordResult).toBeDefined();
      expect(noneRecordResult).toBeDefined();
      if (!aRecordResult || !bRecordResult || !noneRecordResult) return;

      expect(aRecordResult.fields[formulaFieldId]).toBe(1);
      expect(bRecordResult.fields[formulaFieldId]).toBe(2);
      expect(noneRecordResult.fields[formulaFieldId]).toBe(0);
    });

    /**
     * 测试场景：AND 函数
     * 公式：AND({a} > 0, {b} > 0)
     * 预期：所有条件为真时返回 true
     */
    it('should evaluate AND - AND({a} > 0, {b} > 0)', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'AND Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'A' },
            { type: 'number', name: 'B' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const aFieldId = table.fields.find((f) => f.name === 'A')?.id ?? '';
      const bFieldId = table.fields.find((f) => f.name === 'B')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Both Positive',
            options: {
              expression: `AND({${aFieldId}} > 0, {${bFieldId}} > 0)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Both Positive')?.id ?? '';

      // 测试两个都大于0的情况
      const trueRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [aFieldId]: 5, [bFieldId]: 3 },
        }),
      });
      expect(trueRecord.status).toBe(201);
      const trueRaw = await trueRecord.json();
      const trueParsed = createRecordOkResponseSchema.safeParse(trueRaw);
      expect(trueParsed.success).toBe(true);
      if (!trueParsed.success || !trueParsed.data.ok) return;
      const trueRecordId = trueParsed.data.data.record.id;

      // 测试其中一个小于等于0的情况
      const falseRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [aFieldId]: 5, [bFieldId]: -1 },
        }),
      });
      expect(falseRecord.status).toBe(201);
      const falseRaw = await falseRecord.json();
      const falseParsed = createRecordOkResponseSchema.safeParse(falseRaw);
      expect(falseParsed.success).toBe(true);
      if (!falseParsed.success || !falseParsed.data.ok) return;
      const falseRecordId = falseParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const trueRecordResult = records.find((r) => r.id === trueRecordId);
      const falseRecordResult = records.find((r) => r.id === falseRecordId);

      expect(trueRecordResult).toBeDefined();
      expect(falseRecordResult).toBeDefined();
      if (!trueRecordResult || !falseRecordResult) return;

      expect(trueRecordResult.fields[formulaFieldId]).toBe(true);
      expect(falseRecordResult.fields[formulaFieldId]).toBe(false);
    });

    /**
     * 测试场景：OR 函数
     * 公式：OR({a} > 0, {b} > 0)
     * 预期：任一条件为真时返回 true
     */
    it('should evaluate OR - OR({a} > 0, {b} > 0)', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'OR Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'A' },
            { type: 'number', name: 'B' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const aFieldId = table.fields.find((f) => f.name === 'A')?.id ?? '';
      const bFieldId = table.fields.find((f) => f.name === 'B')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Either Positive',
            options: {
              expression: `OR({${aFieldId}} > 0, {${bFieldId}} > 0)`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Either Positive')?.id ?? '';

      // 测试其中一个大于0的情况
      const trueRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [aFieldId]: -1, [bFieldId]: 3 },
        }),
      });
      expect(trueRecord.status).toBe(201);
      const trueRaw = await trueRecord.json();
      const trueParsed = createRecordOkResponseSchema.safeParse(trueRaw);
      expect(trueParsed.success).toBe(true);
      if (!trueParsed.success || !trueParsed.data.ok) return;
      const trueRecordId = trueParsed.data.data.record.id;

      // 测试两个都小于等于0的情况
      const falseRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [aFieldId]: -2, [bFieldId]: -1 },
        }),
      });
      expect(falseRecord.status).toBe(201);
      const falseRaw = await falseRecord.json();
      const falseParsed = createRecordOkResponseSchema.safeParse(falseRaw);
      expect(falseParsed.success).toBe(true);
      if (!falseParsed.success || !falseParsed.data.ok) return;
      const falseRecordId = falseParsed.data.data.record.id;

      // 处理 outbox 以触发公式计算
      await processOutbox();

      // 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const trueRecordResult = records.find((r) => r.id === trueRecordId);
      const falseRecordResult = records.find((r) => r.id === falseRecordId);

      expect(trueRecordResult).toBeDefined();
      expect(falseRecordResult).toBeDefined();
      if (!trueRecordResult || !falseRecordResult) return;

      expect(trueRecordResult.fields[formulaFieldId]).toBe(true);
      expect(falseRecordResult.fields[formulaFieldId]).toBe(false);
    });

    /**
     * 测试场景：XOR 函数
     * 公式：XOR({a}, {b})
     * 预期：异或运算
     */
    it('should evaluate XOR - XOR({a}, {b})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('XOR Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'checkbox', name: 'A' },
            { type: 'checkbox', name: 'B' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const aFieldId = table.fields.find((f) => f.name === 'A')?.id ?? '';
      const bFieldId = table.fields.find((f) => f.name === 'B')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'XorResult',
            options: {
              expression: `XOR({${aFieldId}}, {${bFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'XorResult')?.id ?? '';

      const createRecord = async (a: boolean, b: boolean) => {
        const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: table.id,
            fields: { [aFieldId]: a, [bFieldId]: b },
          }),
        });
        expect(createRecordResponse.status).toBe(201);
        const recordRaw = await createRecordResponse.json();
        const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
        expect(recordParsed.success).toBe(true);
        if (!recordParsed.success || !recordParsed.data.ok) return undefined;
        return recordParsed.data.data.record.id;
      };

      const ff = await createRecord(false, false);
      const tf = await createRecord(true, false);
      const ft = await createRecord(false, true);
      const tt = await createRecord(true, true);

      if (!ff || !tf || !ft || !tt) return;

      await processOutbox();

      const records = await listRecords(table.id);
      const ffRecord = records.find((r) => r.id === ff);
      const tfRecord = records.find((r) => r.id === tf);
      const ftRecord = records.find((r) => r.id === ft);
      const ttRecord = records.find((r) => r.id === tt);

      expect(ffRecord).toBeDefined();
      expect(tfRecord).toBeDefined();
      expect(ftRecord).toBeDefined();
      expect(ttRecord).toBeDefined();
      if (!ffRecord || !tfRecord || !ftRecord || !ttRecord) return;

      expect(ffRecord.fields[formulaFieldId]).toBe(false);
      expect(tfRecord.fields[formulaFieldId]).toBe(true);
      expect(ftRecord.fields[formulaFieldId]).toBe(true);
      expect(ttRecord.fields[formulaFieldId]).toBe(false);
    });

    /**
     * 测试场景：NOT 函数
     * 公式：NOT({condition})
     * 预期：取反
     */
    it('should evaluate NOT - NOT({condition})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('NOT Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'checkbox', name: 'Condition' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const conditionFieldId = table.fields.find((f) => f.name === 'Condition')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Negated',
            options: {
              expression: `NOT({${conditionFieldId}})`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Negated')?.id ?? '';

      const trueRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [conditionFieldId]: true },
        }),
      });
      expect(trueRecord.status).toBe(201);
      const trueRaw = await trueRecord.json();
      const trueParsed = createRecordOkResponseSchema.safeParse(trueRaw);
      expect(trueParsed.success).toBe(true);
      if (!trueParsed.success || !trueParsed.data.ok) return;
      const trueRecordId = trueParsed.data.data.record.id;

      const falseRecord = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [conditionFieldId]: false },
        }),
      });
      expect(falseRecord.status).toBe(201);
      const falseRaw = await falseRecord.json();
      const falseParsed = createRecordOkResponseSchema.safeParse(falseRaw);
      expect(falseParsed.success).toBe(true);
      if (!falseParsed.success || !falseParsed.data.ok) return;
      const falseRecordId = falseParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const trueRecordResult = records.find((r) => r.id === trueRecordId);
      const falseRecordResult = records.find((r) => r.id === falseRecordId);
      expect(trueRecordResult).toBeDefined();
      expect(falseRecordResult).toBeDefined();
      if (!trueRecordResult || !falseRecordResult) return;

      expect(trueRecordResult.fields[formulaFieldId]).toBe(false);
      expect(falseRecordResult.fields[formulaFieldId]).toBe(true);
    });

    /**
     * 测试场景：BLANK 函数
     * 公式：BLANK()
     * 预期：返回空值
     */
    it('should return blank - BLANK()', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('BLANK Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'BlankValue',
            options: {
              expression: `BLANK()`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'BlankValue')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tableId: table.id, fields: {} }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBeNull();
    });

    /**
     * 测试场景：ERROR 函数
     * 公式：ERROR("custom error")
     * 预期：返回错误
     */
    it('should return error - ERROR("custom error")', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('ERROR Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'ErrorValue',
            options: {
              expression: `ERROR("custom error")`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'ErrorValue')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tableId: table.id, fields: {} }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBeNull();
    });

    /**
     * 测试场景：IS_ERROR 函数
     * 公式：IS_ERROR({formulaField})
     * 预期：检测是否为错误
     */
    it('should check if error - IS_ERROR({formulaField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('IS_ERROR Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      const createAlwaysErrorResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'AlwaysError',
            options: {
              expression: `IF({${primaryFieldId}}, ERROR("custom error"), ERROR("custom error"))`,
            },
          },
        }),
      });
      expect(createAlwaysErrorResponse.status).toBe(200);
      const alwaysErrorRaw = await createAlwaysErrorResponse.json();
      const alwaysErrorParsed = createFieldOkResponseSchema.safeParse(alwaysErrorRaw);
      expect(alwaysErrorParsed.success).toBe(true);
      if (!alwaysErrorParsed.success || !alwaysErrorParsed.data.ok) return;

      const alwaysErrorFieldId =
        alwaysErrorParsed.data.data.table.fields.find((f) => f.name === 'AlwaysError')?.id ?? '';

      const createAlwaysOkResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'AlwaysOk',
            options: {
              expression: `IF({${primaryFieldId}}, 1, 1)`,
            },
          },
        }),
      });
      expect(createAlwaysOkResponse.status).toBe(200);
      const alwaysOkRaw = await createAlwaysOkResponse.json();
      const alwaysOkParsed = createFieldOkResponseSchema.safeParse(alwaysOkRaw);
      expect(alwaysOkParsed.success).toBe(true);
      if (!alwaysOkParsed.success || !alwaysOkParsed.data.ok) return;

      const alwaysOkFieldId =
        alwaysOkParsed.data.data.table.fields.find((f) => f.name === 'AlwaysOk')?.id ?? '';

      const createIsErrorErrorResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'IsErrorAlwaysError',
            options: {
              expression: `IF({${primaryFieldId}}, IS_ERROR({${alwaysErrorFieldId}}), IS_ERROR({${alwaysErrorFieldId}}))`,
            },
          },
        }),
      });
      expect(createIsErrorErrorResponse.status).toBe(200);
      const isErrorAlwaysErrorRaw = await createIsErrorErrorResponse.json();
      const isErrorAlwaysErrorParsed = createFieldOkResponseSchema.safeParse(isErrorAlwaysErrorRaw);
      expect(isErrorAlwaysErrorParsed.success).toBe(true);
      if (!isErrorAlwaysErrorParsed.success || !isErrorAlwaysErrorParsed.data.ok) return;

      const isErrorAlwaysErrorFieldId =
        isErrorAlwaysErrorParsed.data.data.table.fields.find((f) => f.name === 'IsErrorAlwaysError')
          ?.id ?? '';

      const createIsErrorOkResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'IsErrorAlwaysOk',
            options: {
              expression: `IF({${primaryFieldId}}, IS_ERROR({${alwaysOkFieldId}}), IS_ERROR({${alwaysOkFieldId}}))`,
            },
          },
        }),
      });
      expect(createIsErrorOkResponse.status).toBe(200);
      const isErrorOkRaw = await createIsErrorOkResponse.json();
      const isErrorOkParsed = createFieldOkResponseSchema.safeParse(isErrorOkRaw);
      expect(isErrorOkParsed.success).toBe(true);
      if (!isErrorOkParsed.success || !isErrorOkParsed.data.ok) return;

      const isErrorOkFieldId =
        isErrorOkParsed.data.data.table.fields.find((f) => f.name === 'IsErrorAlwaysOk')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [primaryFieldId]: 'Row 1' },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[alwaysErrorFieldId]).toBeNull();
      expect(record.fields[alwaysOkFieldId]).toBe(1);
      expect(record.fields[isErrorAlwaysErrorFieldId]).toBe(true);
      expect(record.fields[isErrorOkFieldId]).toBe(false);
    });
  });

  // ============================================================================
  // 9. 日期时间函数
  // ============================================================================
  describe('datetime functions', () => {
    /**
     * 测试场景：NOW 函数
     * 公式：NOW()
     * 预期：返回当前时间
     */
    it('should get current datetime - NOW()', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('NOW Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'NowValue',
            options: {
              expression: `IF({${primaryFieldId}}, NOW(), NOW())`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'NowValue')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tableId: table.id, fields: { [primaryFieldId]: 'Row 1' } }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const nowValue = record.fields[formulaFieldId];
      expect(typeof nowValue).toBe('string');
      if (typeof nowValue !== 'string') return;

      const ts = Date.parse(nowValue);
      expect(Number.isNaN(ts)).toBe(false);

      const diffMs = Math.abs(Date.now() - ts);
      expect(diffMs).toBeLessThan(5 * 60 * 1000);
    });

    /**
     * 测试场景：TODAY 函数
     * 公式：TODAY()
     * 预期：返回今天日期
     */
    it('should get today date - TODAY()', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('TODAY Test'),
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'TodayValue',
            options: {
              expression: `IF({${primaryFieldId}}, TODAY(), TODAY())`,
            },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'TodayValue')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tableId: table.id, fields: { [primaryFieldId]: 'Row 1' } }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const todayValue = record.fields[formulaFieldId];
      expect(typeof todayValue).toBe('string');
      if (typeof todayValue !== 'string') return;

      const parsed = new Date(todayValue);
      expect(Number.isNaN(parsed.getTime())).toBe(false);

      const now = new Date();
      const parsedDay = Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate()
      );
      const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const diffDays = Math.abs(parsedDay - nowDay) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeLessThanOrEqual(1);
    });

    /**
     * 测试场景：YEAR 函数
     * 公式：YEAR({dateField})
     * 预期：提取年份
     */
    it('should get year - YEAR({dateField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('YEAR Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'YearValue',
            options: { expression: `YEAR({${dateFieldId}})` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'YearValue')?.id ?? '';

      const value = '2024-06-15T03:04:05.000Z';
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(new Date(value).getUTCFullYear());
    });

    /**
     * 测试场景：MONTH 函数
     * 公式：MONTH({dateField})
     * 预期：提取月份
     */
    it('should get month - MONTH({dateField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('MONTH Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'MonthValue',
            options: { expression: `MONTH({${dateFieldId}})` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'MonthValue')?.id ?? '';

      const value = '2024-06-15T03:04:05.000Z';
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(new Date(value).getUTCMonth() + 1);
    });

    /**
     * 测试场景：DAY 函数
     * 公式：DAY({dateField})
     * 预期：提取日期
     */
    it('should get day - DAY({dateField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('DAY Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'DayValue',
            options: { expression: `DAY({${dateFieldId}})` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'DayValue')?.id ?? '';

      const value = '2024-06-15T03:04:05.000Z';
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(new Date(value).getUTCDate());
    });

    /**
     * 测试场景：HOUR 函数
     * 公式：HOUR({dateField})
     * 预期：提取小时
     */
    it('should get hour - HOUR({dateField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('HOUR Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'HourValue',
            options: { expression: `HOUR({${dateFieldId}})` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'HourValue')?.id ?? '';

      const value = '2024-06-15T03:04:05.000Z';
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(new Date(value).getUTCHours());
    });

    /**
     * 测试场景：MINUTE 函数
     * 公式：MINUTE({dateField})
     * 预期：提取分钟
     */
    it('should get minute - MINUTE({dateField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('MINUTE Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'MinuteValue',
            options: { expression: `MINUTE({${dateFieldId}})` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'MinuteValue')?.id ?? '';

      const value = '2024-06-15T03:04:05.000Z';
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(new Date(value).getUTCMinutes());
    });

    /**
     * 测试场景：SECOND 函数
     * 公式：SECOND({dateField})
     * 预期：提取秒
     */
    it('should get second - SECOND({dateField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('SECOND Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'SecondValue',
            options: { expression: `SECOND({${dateFieldId}})` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'SecondValue')?.id ?? '';

      const value = '2024-06-15T03:04:05.000Z';
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(new Date(value).getUTCSeconds());
    });

    /**
     * 测试场景：WEEKDAY 函数
     * 公式：WEEKDAY({dateField})
     * 预期：返回星期几（0-6）
     */
    it('should get weekday - WEEKDAY({dateField})', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('WEEKDAY Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'WeekdayValue',
            options: { expression: `WEEKDAY({${dateFieldId}})` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'WeekdayValue')?.id ?? '';

      const value = '2024-06-15T03:04:05.000Z';
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(new Date(value).getUTCDay());
    });

    /**
     * 测试场景：WEEKNUM 函数
     * 公式：WEEKNUM({dateField})
     * 预期：返回第几周
     */
    it('should get week number - WEEKNUM({dateField})', async () => {
      const isoWeekNumber = (date: Date): number => {
        const tmp = new Date(
          Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
        );
        const day = tmp.getUTCDay() || 7;
        tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
        const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
        const diffDays = (tmp.getTime() - yearStart.getTime()) / (24 * 60 * 60 * 1000);
        return Math.ceil((diffDays + 1) / 7);
      };

      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('WEEKNUM Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'WeeknumValue',
            options: { expression: `WEEKNUM({${dateFieldId}})` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'WeeknumValue')?.id ?? '';

      const value = '2024-06-15T03:04:05.000Z';
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(isoWeekNumber(new Date(value)));
    });

    /**
     * 测试场景：DATEADD / DATE_ADD 函数
     * 公式：DATE_ADD({dateField}, 1, "month")
     * 预期：日期加1个月
     */
    it('should add to date - DATE_ADD({dateField}, 1, "month")', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('DATE_ADD Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Added',
            options: { expression: `DATE_ADD({${dateFieldId}}, 1, "month")` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Added')?.id ?? '';

      const value = '2024-01-15T00:00:00.000Z';
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const addedValue = record.fields[formulaFieldId];
      expect(typeof addedValue).toBe('string');
      if (typeof addedValue !== 'string') return;

      const expected = new Date(value);
      expected.setUTCMonth(expected.getUTCMonth() + 1);

      expect(new Date(addedValue).toISOString().slice(0, 10)).toBe(
        expected.toISOString().slice(0, 10)
      );
    });

    /**
     * 测试场景：DATETIME_DIFF 函数
     * 公式：DATETIME_DIFF({date1}, {date2}, "days")
     * 预期：计算日期差（天）
     */
    it('should get datetime diff - DATETIME_DIFF({date1}, {date2}, "days")', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('DATETIME_DIFF Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date1' },
            { type: 'date', name: 'Date2' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const date1FieldId = table.fields.find((f) => f.name === 'Date1')?.id ?? '';
      const date2FieldId = table.fields.find((f) => f.name === 'Date2')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'DiffDays',
            options: { expression: `DATETIME_DIFF({${date1FieldId}}, {${date2FieldId}}, "days")` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'DiffDays')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [date1FieldId]: '2024-01-03T00:00:00.000Z',
            [date2FieldId]: '2024-01-01T00:00:00.000Z',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(2);
    });

    /**
     * 测试场景：DATETIME_FORMAT 函数
     * 公式：DATETIME_FORMAT({dateField}, "YYYY-MM-DD")
     * 预期：格式化日期
     */
    it('should format datetime - DATETIME_FORMAT({dateField}, "YYYY-MM-DD")', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('DATETIME_FORMAT Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Formatted',
            options: { expression: `DATETIME_FORMAT({${dateFieldId}}, "YYYY-MM-DD")` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Formatted')?.id ?? '';

      const value = '2024-06-15T00:00:00.000Z';
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [dateFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe('2024-06-15');
    });

    /**
     * 测试场景：DATETIME_PARSE 函数
     * 公式：DATETIME_PARSE({textField}, "YYYY-MM-DD")
     * 预期：解析日期字符串
     */
    it('should parse datetime - DATETIME_PARSE({textField}, "YYYY-MM-DD")', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('DATETIME_PARSE Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', name: 'TextDate' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const textFieldId = table.fields.find((f) => f.name === 'TextDate')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Parsed',
            options: { expression: `DATETIME_PARSE({${textFieldId}}, "YYYY-MM-DD")` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'Parsed')?.id ?? '';

      const value = '2024-06-15T00:00:00Z';
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: { [textFieldId]: value },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      const parsedValue = record.fields[formulaFieldId];
      expect(typeof parsedValue).toBe('string');
      if (typeof parsedValue !== 'string') return;

      expect(new Date(parsedValue).toISOString()).toBe('2024-06-15T00:00:00.000Z');
    });

    /**
     * 测试场景：IS_SAME 函数
     * 公式：IS_SAME({date1}, {date2}, "day")
     * 预期：判断是否同一天
     */
    it('should check if same - IS_SAME({date1}, {date2}, "day")', async () => {
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: uniqueName('IS_SAME Test'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'date', name: 'Date1' },
            { type: 'date', name: 'Date2' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const date1FieldId = table.fields.find((f) => f.name === 'Date1')?.id ?? '';
      const date2FieldId = table.fields.find((f) => f.name === 'Date2')?.id ?? '';

      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'SameDay',
            options: { expression: `IS_SAME({${date1FieldId}}, {${date2FieldId}}, "day")` },
          },
        }),
      });
      expect(createFieldResponse.status).toBe(200);
      const fieldRaw = await createFieldResponse.json();
      const fieldParsed = createFieldOkResponseSchema.safeParse(fieldRaw);
      expect(fieldParsed.success).toBe(true);
      if (!fieldParsed.success || !fieldParsed.data.ok) return;

      const formulaFieldId =
        fieldParsed.data.data.table.fields.find((f) => f.name === 'SameDay')?.id ?? '';

      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [date1FieldId]: '2024-01-02T12:00:00.000Z',
            [date2FieldId]: '2024-01-02T13:00:00.000Z',
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;
      const recordId = recordParsed.data.data.record.id;

      await processOutbox();

      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      expect(record.fields[formulaFieldId]).toBe(true);
    });

    /**
     * 测试场景：IS_BEFORE 函数
     * 公式：IS_BEFORE({date1}, {date2})
     * 预期：判断 date1 是否在 date2 之前
     */
    test.todo('should check if before - IS_BEFORE({date1}, {date2})');

    /**
     * 测试场景：IS_AFTER 函数
     * 公式：IS_AFTER({date1}, {date2})
     * 预期：判断 date1 是否在 date2 之后
     */
    test.todo('should check if after - IS_AFTER({date1}, {date2})');

    /**
     * 测试场景：SET_LOCALE 函数
     * 公式：SET_LOCALE({dateField}, "zh-CN")
     * 预期：设置日期的区域设置
     */
    test.todo('should set locale - SET_LOCALE({dateField}, "zh-CN")');

    /**
     * 测试场景：SET_TIMEZONE 函数
     * 公式：SET_TIMEZONE({dateField}, "Asia/Shanghai")
     * 预期：设置时区
     */
    test.todo('should set timezone - SET_TIMEZONE({dateField}, "Asia/Shanghai")');

    /**
     * 测试场景：CREATED_TIME 函数
     * 公式：CREATED_TIME()
     * 预期：返回记录创建时间
     */
    test.todo('should get created time - CREATED_TIME()');

    /**
     * 测试场景：LAST_MODIFIED_TIME 函数
     * 公式：LAST_MODIFIED_TIME()
     * 预期：返回最后修改时间
     */
    test.todo('should get last modified time - LAST_MODIFIED_TIME()');

    /**
     * 测试场景：公式使用时区配置格式化日期
     * 公式：DATETIME_FORMAT({dateField}, "YYYYMMDD") with timeZone: "Asia/Shanghai"
     * 预期：使用配置的时区格式化日期
     */
    test.todo('should format datetime with timezone config - DATETIME_FORMAT with timeZone option');
  });

  // ============================================================================
  // 10. 数组函数
  // ============================================================================
  describe('array functions', () => {
    /**
     * 测试场景：ARRAYJOIN 函数
     * 公式：ARRAYJOIN({multiSelectField}, ", ")
     * 预期：用分隔符连接数组元素
     */
    test.todo('should join array - ARRAYJOIN({multiSelectField}, ", ")');

    /**
     * 测试场景：ARRAYUNIQUE 函数
     * 公式：ARRAYUNIQUE({lookupField})
     * 预期：返回去重后的数组
     */
    test.todo('should get unique array - ARRAYUNIQUE({lookupField})');

    /**
     * 测试场景：ARRAYFLATTEN 函数
     * 公式：ARRAYFLATTEN({nestedArray})
     * 预期：展平嵌套数组
     */
    test.todo('should flatten array - ARRAYFLATTEN({nestedArray})');

    /**
     * 测试场景：ARRAYCOMPACT 函数
     * 公式：ARRAYCOMPACT({arrayWithNulls})
     * 预期：移除空值
     */
    test.todo('should compact array - ARRAYCOMPACT({arrayWithNulls})');

    /**
     * 测试场景：COUNTALL 函数
     * 公式：COUNTALL({lookupField})
     * 预期：返回所有元素数量（包含空值）
     */
    test.todo('should count all - COUNTALL({lookupField})');

    /**
     * 测试场景：COUNTA 函数
     * 公式：COUNTA({lookupField})
     * 预期：返回非空元素数量
     */
    test.todo('should count non-empty - COUNTA({lookupField})');

    /**
     * 测试场景：COUNT 函数
     * 公式：COUNT({lookupField})
     * 预期：返回数字元素数量
     */
    test.todo('should count numbers - COUNT({lookupField})');
  });

  // ============================================================================
  // 11. 链接和查找字段公式
  // ============================================================================
  describe('formula with link and lookup fields', () => {
    /**
     * 测试场景：公式引用链接字段
     * 公式：IF({linkField}, "Has Link", "No Link")
     * 预期：有链接返回 "Has Link"
     */
    test.todo(
      'should create formula referencing link field - IF({linkField}, "Has Link", "No Link")'
    );

    /**
     * 测试场景：公式引用查找字段
     * 公式：{lookupField}
     * 预期：返回查找字段的值
     */
    test.todo('should create formula referencing lookup field - {lookupField}');

    /**
     * 测试场景：公式引用汇总字段
     * 公式：{rollupField} * 2
     * 预期：汇总值乘以2
     */
    test.todo('should create formula referencing rollup field - {rollupField} * 2');

    /**
     * 测试场景：公式处理查找字段为空的情况
     * 公式：IF({lookupField}="", "no lookup", {lookupField})
     * 预期：空查找时返回 "no lookup"
     */
    test.todo(
      'should handle empty lookup in formula - IF({lookupField}="", "no lookup", {lookupField})'
    );

    /**
     * 测试场景：公式处理汇总字段为空的情况
     * 公式：IF({rollupField} > 0, "Has rollup", "No rollup")
     * 预期：无汇总数据时返回 "No rollup"
     */
    test.todo(
      'should handle empty rollup in formula - IF({rollupField} > 0, "Has rollup", "No rollup")'
    );

    /**
     * 测试场景：公式引用链接字段的显示值（formula referencing link display）
     * 公式：{linkField}
     * 预期：返回链接字段的显示值（主字段值）
     */
    test.todo('should get link field display value in formula - {linkField}');

    /**
     * 测试场景：公式引用查找单选字段
     * 公式：IF({lookupSingleSelect}="Paid", "No reminder", "Follow up")
     * 预期：根据查找的单选值判断
     */
    test.todo(
      'should handle lookup single select in formula - IF({lookupSingleSelect}="Paid", ...)'
    );

    /**
     * 测试场景：嵌套查找公式（lookup -> lookup -> number）
     * 公式：Table3 -> Table2(lookup) -> Table1(number)
     * 预期：正确获取嵌套查找的值
     */
    test.todo('should handle nested lookup formula - lookup of lookup field');

    /**
     * 测试场景：链接显示依赖查找的公式
     * 公式：{orderNo} & "-" & {patientLink} (link display depends on lookup)
     * 预期：链接显示字段依赖另一个查找字段时正确计算
     */
    test.todo('should compute formula when link display depends on lookup');
  });

  // ============================================================================
  // 12. 公式引用公式
  // ============================================================================
  describe('formula referencing formula', () => {
    /**
     * 测试场景：公式引用另一个公式
     * 公式：{formula1} + 5
     * 预期：正确计算嵌套公式
     */
    it('should create formula referencing another formula - {formula1} + 5', async () => {
      // 1. 创建表，包含数字字段
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'Formula Reference Formula Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'BaseValue' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'BaseValue')?.id ?? '';

      // 2. 创建第一个公式字段 - 数字 * 2
      const createFormula1Response = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Formula1',
            options: {
              expression: `{${numberFieldId}} * 2`,
            },
          },
        }),
      });
      expect(createFormula1Response.status).toBe(200);
      const formula1Raw = await createFormula1Response.json();
      const formula1Parsed = createFieldOkResponseSchema.safeParse(formula1Raw);
      expect(formula1Parsed.success).toBe(true);
      if (!formula1Parsed.success || !formula1Parsed.data.ok) return;

      const formula1FieldId =
        formula1Parsed.data.data.table.fields.find((f) => f.name === 'Formula1')?.id ?? '';

      // 3. 创建第二个公式字段 - 引用第一个公式 + 5
      const createFormula2Response = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Formula2',
            options: {
              expression: `{${formula1FieldId}} + 5`,
            },
          },
        }),
      });
      expect(createFormula2Response.status).toBe(200);
      const formula2Raw = await createFormula2Response.json();
      const formula2Parsed = createFieldOkResponseSchema.safeParse(formula2Raw);
      expect(formula2Parsed.success).toBe(true);
      if (!formula2Parsed.success || !formula2Parsed.data.ok) return;

      const formula2FieldId =
        formula2Parsed.data.data.table.fields.find((f) => f.name === 'Formula2')?.id ?? '';

      // 4. 创建记录
      const createRecordResponse = await fetch(`${baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [numberFieldId]: 10,
          },
        }),
      });
      expect(createRecordResponse.status).toBe(201);
      const recordRaw = await createRecordResponse.json();
      const recordParsed = createRecordOkResponseSchema.safeParse(recordRaw);
      expect(recordParsed.success).toBe(true);
      if (!recordParsed.success || !recordParsed.data.ok) return;

      const recordId = recordParsed.data.data.record.id;

      // 5. 处理 outbox 以触发公式计算（需要多次处理以支持嵌套公式）
      await processOutbox(2);

      // 6. 通过 listRecords 获取计算后的记录
      const records = await listRecords(table.id);
      const record = records.find((r) => r.id === recordId);
      expect(record).toBeDefined();
      if (!record) return;

      // 7. 验证公式计算结果
      expect(record.fields[formula1FieldId]).toBe(20); // 10 * 2 = 20
      expect(record.fields[formula2FieldId]).toBe(25); // 20 + 5 = 25
    });

    /**
     * 测试场景：多层公式链
     * 公式：formula1 -> formula2 -> formula3 -> rollup field
     * 预期：多层嵌套公式正确计算
     */
    test.todo('should handle multi-level formula chain');

    /**
     * 测试场景：公式间接引用链接字段
     * 公式：formula1 -> formula2(references link) -> link field
     * 预期：通过另一个公式间接引用链接字段时正确计算
     */
    test.todo('should handle formula indirectly referencing link field through another formula');

    /**
     * 测试场景：公式间接引用查找字段
     * 公式：formula1 -> formula2(references lookup) -> lookup field
     * 预期：通过另一个公式间接引用查找字段时正确计算
     */
    test.todo('should handle formula indirectly referencing lookup field through another formula');

    /**
     * 测试场景：公式间接引用汇总字段
     * 公式：formula1 -> formula2(references rollup) -> rollup field
     * 预期：通过另一个公式间接引用汇总字段时正确计算
     */
    test.todo('should handle formula indirectly referencing rollup field through another formula');
  });

  // ============================================================================
  // 13. 公式重新计算场景
  // ============================================================================
  describe('formula recalculation scenarios', () => {
    /**
     * 测试场景：创建记录时省略引用字段，公式仍应计算
     * 公式：IF({statusField}="", 1, 222222)
     * 预期：状态字段省略时，公式返回 1
     */
    test.todo(
      'should calculate formula when referenced field is omitted on creation - IF({status}="", 1, 222222)'
    );

    /**
     * 测试场景：创建记录时提供引用字段，公式返回另一个分支
     * 公式：IF({statusField}="", 1, 222222)
     * 预期：状态字段有值时，公式返回 222222
     */
    test.todo(
      'should calculate alternate branch when referenced field has value - IF({status}="", 1, 222222)'
    );

    /**
     * 测试场景：基于查找的公式在省略链接时的计算
     * 公式：IF({lookupField}="", "no lookup", {lookupField})
     * 预期：链接省略时，公式返回 "no lookup"
     */
    test.todo('should compute lookup-based formula when link is omitted on creation');

    /**
     * 测试场景：基于查找的公式在提供链接时的计算
     * 公式：IF({lookupField}="", "no lookup", {lookupField})
     * 预期：链接提供时，公式返回查找值
     */
    test.todo('should compute lookup-based formula when link is provided on creation');

    /**
     * 测试场景：即使 reference 表缺少条目也应回退
     * 预期：即使引用关系表损坏，公式也应返回默认值
     */
    test.todo('should fallback even if reference table is missing entries');

    /**
     * 测试场景：即使查找字段未标记为 computed 也应回退
     * 预期：即使 isComputed 被错误设置为 false，公式也应正确计算
     */
    test.todo('should fallback even if lookup fields are not marked computed');

    /**
     * 测试场景：即使引用图完全缺失也应回退
     * 预期：引用关系完全删除时，公式仍应返回默认值
     */
    test.todo('should fallback even if reference graph is completely missing');
  });

  // ============================================================================
  // 14. 错误处理场景
  // ============================================================================
  describe('formula error scenarios', () => {
    /**
     * 测试场景：无效的表达式语法
     * 公式：INVALID_FUNCTION({field})
     * 预期：返回 400 错误
     */
    it('should fail with invalid expression syntax - INVALID_FUNCTION({field})', async () => {
      // 1. 创建表
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'Invalid Formula Test',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Value' },
          ],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;
      const numberFieldId = table.fields.find((f) => f.name === 'Value')?.id ?? '';

      // 2. 尝试创建使用无效函数的公式字段
      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Invalid Formula',
            options: {
              expression: `INVALID_FUNCTION({${numberFieldId}})`,
            },
          },
        }),
      });

      // 3. 验证返回 500 错误（无效的函数会导致解析错误）
      expect(createFieldResponse.status).toBe(500);
    });

    /**
     * 测试场景：引用不存在的字段
     * 公式：{nonExistentFieldId}
     * 预期：返回 404 错误
     */
    it('should fail with non-existent field reference - {nonExistentFieldId}', async () => {
      // 1. 创建表
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'Nonexistent Field Test',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;

      // 2. 尝试创建引用不存在字段的公式
      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Invalid Reference',
            options: {
              expression: '{fldnonexistent00001}',
            },
          },
        }),
      });

      // 3. 验证返回 404 错误（引用不存在的字段）
      expect(createFieldResponse.status).toBe(404);
    });

    /**
     * 测试场景：空表达式
     * 公式：""
     * 预期：返回 400 错误
     */
    it('should fail with empty expression', async () => {
      // 1. 创建表
      const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          name: 'Empty Expression Test',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        }),
      });
      const tableRaw = await createTableResponse.json();
      const tableParsed = createTableOkResponseSchema.safeParse(tableRaw);
      expect(tableParsed.success).toBe(true);
      if (!tableParsed.success || !tableParsed.data.ok) return;

      const table = tableParsed.data.data.table;

      // 2. 尝试创建空表达式的公式
      const createFieldResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Empty Formula',
            options: {
              expression: '',
            },
          },
        }),
      });

      // 3. 验证返回 400 错误
      expect(createFieldResponse.status).toBe(400);
    });

    /**
     * 测试场景：循环引用
     * 公式：formula1 -> formula2 -> formula1
     * 预期：返回错误（循环依赖）
     */
    test.todo('should fail with circular reference');

    /**
     * 测试场景：除以零
     * 公式：{numberField} / 0
     * 预期：返回错误或无穷大
     */
    test.todo('should handle division by zero - {numberField} / 0');
  });

  // ============================================================================
  // 15. 复杂公式场景
  // ============================================================================
  describe('complex formula scenarios', () => {
    /**
     * 测试场景：多字段引用的字符串拼接
     * 公式：CONCATENATE({firstName}, " ", {lastName})
     * 预期：正确拼接多个字段
     */
    test.todo(
      'should create formula with string concatenation - CONCATENATE({firstName}, " ", {lastName})'
    );

    /**
     * 测试场景：条件逻辑组合
     * 公式：IF(AND({age} >= 18, {isActive}), "Adult Active", IF({age} >= 18, "Adult Inactive", "Minor"))
     * 预期：复杂条件逻辑正确计算
     */
    test.todo(
      'should create formula with conditional logic - IF(AND({age} >= 18, {isActive}), ...)'
    );

    /**
     * 测试场景：数学运算组合
     * 公式：ROUND(({score} * {age}) / 10, 2)
     * 预期：数学运算正确计算
     */
    test.todo(
      'should create formula with mathematical operations - ROUND(({score} * {age}) / 10, 2)'
    );

    /**
     * 测试场景：日期函数组合
     * 公式：YEAR({birthDate})
     * 预期：提取出生年份
     */
    test.todo('should create formula with date functions - YEAR({birthDate})');

    /**
     * 测试场景：查找日期时间格式化的拼接
     * 公式："NAS-" & {schoolLookup} & "-" & DATETIME_FORMAT({dateLookup}, "YYYYMMDD")
     * 预期：正确拼接查找字段和格式化日期
     */
    test.todo(
      'should concatenate lookup datetime output safely - "NAS-" & {schoolLookup} & "-" & DATETIME_FORMAT({dateLookup}, "YYYYMMDD")'
    );

    /**
     * 测试场景：本地化单选字段的数值转换
     * 公式：VALUE({singleSelectField}) - 解析 "20分钟" 为 20
     * 预期：从选项标签中提取数字
     */
    test.todo('should parse localized option labels through VALUE() - VALUE({singleSelectField})');
  });

  // ============================================================================
  // 15.1 Customer-grade complex formula templates (todo only)
  // ============================================================================
  describe('customer-grade complex formula templates (todo)', () => {
    /**
     * Scenario: Very long IF/FIND concatenation mapping (text field + many branches).
     * Formula: IF(FIND("A", {codeField})>0, "A", "") & IF(FIND("B", {codeField})>0, "B", "") & ...
     * Expect: Long chained concatenation remains stable.
     */
    test.todo('should handle long IF/FIND concatenation mapping');

    /**
     * Scenario: Large SWITCH mapping table (text -> text).
     * Formula: SWITCH({appId}, "id1", "Name1", "id2", "Name2", ..., BLANK())
     * Expect: Large lookup table mapping remains stable.
     */
    test.todo('should handle large SWITCH mapping table');

    /**
     * Scenario: Complex text parsing (MID/FIND/LEFT chain).
     * Formula: IF({textField}, LEFT(MID({textField}, ...), ...), "fallback")
     * Expect: Multi-delimiter parsing remains stable.
     */
    test.todo('should parse complex text with MID/FIND/LEFT chain');

    /**
     * Scenario: Large numeric aggregation (many SUM arguments).
     * Formula: SUM({num1}, {num2}, ... {num39})
     * Expect: Summation across many fields is correct.
     */
    test.todo('should sum many numeric fields in a single formula');

    /**
     * Scenario: Multi-field conditional count (single select comparisons + SUM).
     * Formula: SUM({status1}="X", {status2}="X", ...)
     * Expect: Batch conditional count remains correct.
     */
    test.todo('should sum many single-select comparisons');

    /**
     * Scenario: Nested IF + SUM threshold logic (multiple numeric fields).
     * Formula: IF(SUM({a},{b})>1.6, SUM({a},{b})/1.6*..., 1)
     * Expect: Threshold branching is correct.
     */
    test.todo('should handle nested IF with SUM threshold logic');

    /**
     * Scenario: Branching pricing/cost formula (select + multi-number + MAX).
     * Formula: MAX(IF({mode}="A", {qty}*{rateA}, IF({mode}="B", {qty}*{rateB}, ...)), {fallback})
     * Expect: Branch selection is correct.
     */
    test.todo('should handle branching pricing formula with MAX and IF');

    /**
     * Scenario: Multi-field cost aggregation (sum of numbers).
     * Formula: {cost1}+{cost2}+{cost3}+{cost4}+{cost5}+{cost6}
     * Expect: Summation across multiple fields is correct.
     */
    test.todo('should handle multi-field cost aggregation');

    /**
     * Scenario: Conditional settlement date formatting (IF + DATETIME_FORMAT).
     * Formula: IF({status}="X", DATETIME_FORMAT({dateA}, "YYYY-MM-DD"), DATETIME_FORMAT({dateB}, "YYYY-MM-DD"))
     * Expect: Conditional date formatting is correct.
     */
    test.todo('should handle conditional datetime formatting chain');

    /**
     * Scenario: Inventory countdown (DATE_ADD + IS_AFTER + CONCATENATE).
     * Formula: IF(IS_AFTER(DATE_ADD({date}, {days}, "day"), NOW()), CONCATENATE(...), ...)
     * Expect: Date comparison and concatenation remain stable.
     */
    test.todo('should handle inventory countdown with DATE_ADD and IS_AFTER');

    /**
     * Scenario: Tiered adjustments (nested IF + select coefficient).
     * Formula: IF({category}="A", {price}*0.7, IF({category}="B", {price}*0.5, ...))
     * Expect: Tier coefficients are applied correctly.
     */
    test.todo('should handle tiered adjustments by category');

    /**
     * Scenario: Stock status thresholds (two numbers + nested IF).
     * Formula: IF({stock}<= {min}, "low", IF({stock}<= {min}*1.5, "mid", "ok"))
     * Expect: Threshold status is correct.
     */
    test.todo('should handle nested stock status thresholds');

    /**
     * Scenario: Composite key concatenation (multiple text fields).
     * Formula: CONCATENATE({a}, "-", {b}, "-", {c})
     * Expect: Concatenation output is stable.
     */
    test.todo('should concatenate multiple fields as composite key');

    /**
     * Scenario: Lookup + date formatting concatenation.
     * Formula: {lookupText} & "-" & DATETIME_FORMAT({lookupDate}, "YYYYMMDD")
     * Expect: Cross-table concatenation is correct.
     */
    test.todo('should concatenate lookup text with formatted lookup date');

    /**
     * Scenario: Mixed lookup + rollup aggregation.
     * Formula: IF(SUM({lookupNums})>0, {rollupSum} / SUM({lookupNums}), 0)
     * Expect: Aggregation remains stable with linked data.
     */
    test.todo('should handle lookup + rollup mixed aggregation');
  });

  // ============================================================================
  // 16. 特殊边界情况
  // ============================================================================
  describe('special edge cases', () => {
    /**
     * 测试场景：空值处理
     * 公式：IF({field} = BLANK(), "empty", "has value")
     * 预期：正确识别空值
     */
    test.todo('should handle blank values - IF({field} = BLANK(), "empty", "has value")');

    /**
     * 测试场景：非常长的文本
     * 公式：LEN({longTextField})
     * 预期：正确计算长文本的长度
     */
    test.todo('should handle very long text - LEN({longTextField})');

    /**
     * 测试场景：特殊字符
     * 公式：{textField} with special characters like emoji, unicode
     * 预期：正确处理特殊字符
     */
    test.todo('should handle special characters in text fields');

    /**
     * 测试场景：极大数值
     * 公式：{numberField} with very large numbers
     * 预期：正确处理大数值
     */
    test.todo('should handle very large numbers');

    /**
     * 测试场景：极小数值（浮点精度）
     * 公式：{numberField} with very small decimals
     * 预期：正确处理小数精度
     */
    test.todo('should handle very small decimals (floating point precision)');

    /**
     * 测试场景：负数
     * 公式：ABS({negativeNumber})
     * 预期：正确处理负数
     */
    test.todo('should handle negative numbers - ABS({negativeNumber})');

    /**
     * 测试场景：空字符串 vs null vs undefined
     * 公式：IF({field}="", "empty string", "not empty string")
     * 预期：正确区分空字符串和 null
     */
    test.todo('should distinguish empty string vs null vs undefined');

    /**
     * 测试场景：记录只发送 null 值时的回退
     * 公式：当唯一发送的字段显式为 null 时
     * 预期：公式仍应正确计算默认值
     */
    test.todo('should fallback when the only field sent is explicitly null');
  });

  // ============================================================================
  // 17. 公式字段选项
  // ============================================================================
  describe('formula field options', () => {
    /**
     * 测试场景：公式字段带数字格式化选项
     * 公式：{numberField} * 2
     * 选项：formatting: { type: 'decimal', precision: 1 }
     * 预期：结果按指定精度格式化
     */
    test.todo('should apply number formatting to formula result');

    /**
     * 测试场景：公式字段带 showAs 选项（进度条）
     * 公式：{numberField}
     * 选项：showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 }
     * 预期：公式结果以进度条形式显示
     */
    test.todo('should apply showAs option to formula field - bar display');

    /**
     * 测试场景：公式字段带时区选项
     * 公式：DATETIME_FORMAT({dateField}, "YYYY-MM-DD HH:mm")
     * 选项：timeZone: "Asia/Shanghai"
     * 预期：使用指定时区格式化
     */
    test.todo('should apply timezone option to formula field');
  });
});
