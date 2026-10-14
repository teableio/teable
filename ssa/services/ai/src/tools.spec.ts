import { describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger.js';
import { createTeableToolClient, createToolExecutor, toolSpecs } from './tools.js';

const logger = createLogger('error', 'test');

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('createTeableToolClient', () => {
  it('queries records with name keys, text cells and clamped take', async () => {
    let capturedUrl = '';
    let capturedAuth = '';
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedAuth = (init?.headers as Record<string, string>).authorization ?? '';
      return jsonResponse({ records: [] });
    }) as unknown as typeof fetch;

    const client = createTeableToolClient(
      { baseUrl: 'http://teable.local', token: 'pat123' },
      logger,
      fetchImpl
    );
    await client.queryRecords('tbl1', { viewId: 'viw1', take: 500 });

    expect(capturedUrl).toContain('/api/table/tbl1/record?');
    expect(capturedUrl).toContain('fieldKeyType=name');
    expect(capturedUrl).toContain('cellFormat=text');
    expect(capturedUrl).toContain('take=50');
    expect(capturedUrl).toContain('viewId=viw1');
    expect(capturedAuth).toBe('Bearer pat123');
  });

  it('writes records by name with typecast enabled', async () => {
    let capturedBody: Record<string, unknown> = {};
    let capturedMethod = '';
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      capturedMethod = init?.method ?? '';
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ records: [] });
    }) as unknown as typeof fetch;

    const client = createTeableToolClient(
      { baseUrl: 'http://teable.local', token: 'pat123' },
      logger,
      fetchImpl
    );
    await client.createRecords('tbl1', [{ fields: { Task: 'hello' } }]);

    expect(capturedMethod).toBe('POST');
    expect(capturedBody.fieldKeyType).toBe('name');
    expect(capturedBody.typecast).toBe(true);
  });
});

describe('createToolExecutor', () => {
  const client = {
    listTables: vi.fn(async () => [{ id: 'tbl1', name: 'Tasks' }]),
    getTableSchema: vi.fn(async () => ({ id: 'tbl1' })),
    queryRecords: vi.fn(async () => ({ records: [{ id: 'rec1' }] })),
    createRecords: vi.fn(async () => ({ records: [{ id: 'rec2' }] })),
    updateRecords: vi.fn(async () => ({ records: [{ id: 'rec1' }] })),
  };

  it('exposes list/schema/query/create/update tools and no delete tool', () => {
    const names = toolSpecs.map((spec) => spec.function.name);
    expect(names).toEqual([
      'list_tables',
      'get_table_schema',
      'query_records',
      'create_records',
      'update_records',
    ]);
    expect(names).not.toContain('delete_records');
  });

  it('falls back to the request context for base and table ids', async () => {
    const executor = createToolExecutor({ client, current: { baseId: 'bse1', tableId: 'tbl1' } });

    const list = await executor.execute('list_tables', '{}');
    expect(list.ok).toBe(true);
    expect(client.listTables).toHaveBeenCalledWith('bse1');

    const query = await executor.execute('query_records', '{"take":5}');
    expect(query.ok).toBe(true);
    expect(client.queryRecords).toHaveBeenCalledWith('tbl1', {
      take: 5,
      viewId: undefined,
      search: undefined,
    });
  });

  it('rejects invalid arguments without throwing', async () => {
    const executor = createToolExecutor({ client, current: {} });

    const noTable = await executor.execute('query_records', '{}');
    expect(noTable).toMatchObject({ ok: false });

    const emptyCreate = await executor.execute('create_records', '{"tableId":"tbl1","records":[]}');
    expect(emptyCreate.ok).toBe(false);

    const badJson = await executor.execute('query_records', 'not-json');
    expect(badJson.ok).toBe(false);

    const unknown = await executor.execute('do_something', '{}');
    expect(unknown).toMatchObject({ ok: false, result: 'unknown tool: do_something' });
  });
});
