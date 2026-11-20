import type { ExecuteDataQueryRequest } from '@teable/v2-data-query';
import { describe, expect, it, vi } from 'vitest';

import { createDataQueryHttpClient } from './dataQuery';

const request: ExecuteDataQueryRequest = {
  definition: {
    version: 1,
    kind: 'records',
    tableId: `tbl${'a'.repeat(16)}`,
    select: [{ fieldId: `fld${'b'.repeat(16)}`, alias: 'title' }],
    parameters: { title: { type: 'string' } },
  },
  parameters: { title: 'Visible order' },
};

describe('opt-in data query HTTP client', () => {
  it.each([
    { limit: 2, nextCursor: 'opaque-cursor+/=' },
    { limit: 2, nextCursor: null },
    { limit: 2, nextCursor: 'opaque-cursor+/=', total: 3 },
    { limit: 2, nextCursor: null, total: 0 },
  ])('transports V7 cursor parameters and preserves the page response %j', async (page) => {
    const input: ExecuteDataQueryRequest = {
      definition: {
        version: 7,
        kind: 'records',
        tableId: request.definition.tableId,
        select: [{ fieldId: `fld${'b'.repeat(16)}`, alias: 'title' }],
        parameters: {
          title: { type: 'string' },
          cursor: { type: 'string' },
          size: { type: 'number' },
        },
        page: {
          limit: { type: 'parameter', name: 'size' },
          after: { type: 'parameter', name: 'cursor' },
          ...('total' in page ? { includeTotal: true } : {}),
        },
      },
      parameters: { title: 'Visible order', size: 2, cursor: 'previous-cursor+/=' },
    };
    const body = { ok: true, data: { rows: [{ title: 'Visible order' }], page } };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(body));
    const client = createDataQueryHttpClient({ baseUrl: 'https://host/api/v2', fetch: fetcher });
    expect(await client.execute(input)).toEqual(body);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(input);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('omits the cursor parameter on the first V7 page without inventing an offset or total', async () => {
    const input: ExecuteDataQueryRequest = {
      definition: {
        version: 7,
        kind: 'records',
        tableId: request.definition.tableId,
        select: [{ system: 'id', alias: 'id' }],
        parameters: { cursor: { type: 'string' } },
        page: { limit: 1, after: { type: 'parameter', name: 'cursor' } },
      },
    };
    const body = { ok: true, data: { rows: [], page: { limit: 1, nextCursor: null } } };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(body));
    const client = createDataQueryHttpClient({ baseUrl: 'https://host/api/v2', fetch: fetcher });
    expect(await client.execute(input)).toEqual(body);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(input);
  });

  it.each([
    { limit: 1 },
    { limit: 1, nextCursor: 1 },
    { limit: 1, nextCursor: null, offset: 0 },
    { limit: 1, nextCursor: null, total: -1 },
    { limit: 1, nextCursor: null, total: null },
  ])('rejects malformed cursor page metadata %j', async (page) => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ ok: true, data: { rows: [], page } })
    );
    const client = createDataQueryHttpClient({ baseUrl: 'https://host/api/v2', fetch: fetcher });
    expect(await client.execute(request)).toMatchObject({
      ok: false,
      error: { code: 'data_query.invalid_response' },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves invalid cursor errors without restarting pagination or falling back', async () => {
    const body = {
      ok: false,
      error: {
        code: 'data_query.invalid_cursor',
        message: 'Invalid structured query cursor',
        tags: ['validation'],
      },
    };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(body, { status: 400 }));
    const client = createDataQueryHttpClient({ baseUrl: 'https://host/api/v2', fetch: fetcher });
    expect(await client.execute(request)).toEqual(body);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('transports the canonical V6 records DISTINCT request without rewriting the tuple or later-page total', async () => {
    const input: ExecuteDataQueryRequest = {
      definition: {
        version: 6,
        kind: 'records',
        tableId: request.definition.tableId,
        distinct: true,
        select: [{ fieldId: `fld${'b'.repeat(16)}`, alias: 'title' }],
        sort: [{ alias: 'title', order: 'asc' }],
        page: { limit: 1, offset: 99, includeTotal: true },
      },
    };
    const body = { ok: true, data: { rows: [], page: { limit: 1, offset: 99, total: 2 } } };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(body));
    const client = createDataQueryHttpClient({ baseUrl: 'https://host/api/v2', fetch: fetcher });
    expect(await client.execute(input)).toEqual(body);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(input);
  });
  it('transports native v4 metric and HAVING definitions without rewriting public values', async () => {
    const definition: ExecuteDataQueryRequest['definition'] = {
      version: 4,
      kind: 'aggregate',
      tableId: request.definition.tableId,
      parameters: { minimum: { type: 'number' } },
      aggregates: [
        {
          alias: 'total',
          statisticFunc: 'sum',
          expr: {
            type: 'formula',
            formula: '{amount} * 2',
            references: { amount: { type: 'field', fieldId: `fld${'b'.repeat(16)}` } },
          },
          filter: { fieldId: `fld${'b'.repeat(16)}`, operator: 'isGreater', value: 0 },
        },
      ],
      having: {
        type: 'formula',
        formula: '{total} >= {minimum}',
        references: {
          total: { type: 'output', alias: 'total' },
          minimum: { type: 'parameter', name: 'minimum' },
        },
      },
      page: { limit: 1, includeTotal: true },
    };
    const result = {
      ok: true,
      data: { rows: [{ total: '9007199254740993' }], page: { limit: 1, offset: 0, total: 1 } },
    };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(result));
    const client = createDataQueryHttpClient({ baseUrl: 'https://host/api/v2', fetch: fetcher });
    const input = { definition, parameters: { minimum: 30 } };
    expect(await client.execute(input)).toEqual(result);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(input);
  });

  it('validates definitions through the same authenticated fetch transport without parameters', async () => {
    const body = {
      ok: true,
      data: {
        outputs: [
          {
            alias: 'title',
            cellValueType: 'string',
            wireType: 'string' as const,
            isMultipleCellValue: false,
            nullable: true,
          },
        ],
      },
    };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(body));
    const client = createDataQueryHttpClient({
      baseUrl: 'https://host/api/v2/',
      headers: { Authorization: 'Bearer test' },
      fetch: fetcher,
    });
    expect(await client.validate({ definition: request.definition })).toEqual(body);
    expect(fetcher.mock.calls[0][0]).toBe('https://host/api/v2/queries/validate');
    const init = fetcher.mock.calls[0][1];
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test');
    expect(JSON.parse(String(init?.body))).toEqual({ definition: request.definition });
    const invalid = { definition: request.definition, parameters: {} };
    expect(await client.validate(invalid)).toMatchObject({
      ok: false,
      error: { code: 'data_query.invalid_request' },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('requests and parses logical usage only when explicitly opted in', async () => {
    let sent: unknown;
    const body = {
      ok: true,
      data: {
        outputs: [],
        usage: [
          {
            source: 'root',
            tableId: request.definition.tableId,
            fieldId: `fld${'b'.repeat(16)}`,
            usages: ['projection'] as const,
          },
        ],
      },
    };
    const client = createDataQueryHttpClient({
      baseUrl: 'https://host/api/v2',
      fetch: async (_input, init) => {
        sent = JSON.parse(String(init?.body));
        return Response.json(body);
      },
    });

    expect(await client.validate({ definition: request.definition, includeUsage: true })).toEqual(
      body
    );
    expect(sent).toEqual({ definition: request.definition, includeUsage: true });
  });

  it('rejects an outputs-only success when usage was requested', async () => {
    const client = createDataQueryHttpClient({
      baseUrl: 'https://host/api/v2',
      fetch: async () => Response.json({ ok: true, data: { outputs: [] } }),
    });

    expect(await client.validate({ definition: request.definition, includeUsage: true })).toEqual({
      ok: false,
      error: {
        code: 'data_query.invalid_response',
        message: 'Invalid data query response',
        tags: ['unexpected'],
      },
    });
  });

  it('rejects execution rows and extra properties from the validate response', async () => {
    for (const body of [
      { ok: true, data: { rows: [] } },
      { ok: true, data: { outputs: [], sql: 'private' } },
      {
        ok: true,
        data: {
          outputs: [],
          usage: [
            {
              source: 'root',
              tableId: request.definition.tableId,
              fieldId: `fld${'b'.repeat(16)}`,
              usages: ['projection'],
              column: 'private_column',
            },
          ],
        },
      },
    ]) {
      const client = createDataQueryHttpClient({
        baseUrl: 'https://host/api/v2',
        fetch: async () => Response.json(body),
      });
      expect(await client.validate({ definition: request.definition })).toMatchObject({
        ok: false,
        error: { code: 'data_query.invalid_response' },
      });
    }
  });
  it('preserves canonical domain errors without falling back to SQL', async () => {
    const body = {
      ok: false,
      error: {
        code: 'data_query.forbidden',
        message: 'Data query access denied',
        tags: ['forbidden'],
        details: { permission: 'execute' },
        localization: { i18nKey: 'queryDenied', context: { permission: 'execute' } },
      },
    };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(body, { status: 403 }));
    const client = createDataQueryHttpClient({ baseUrl: 'https://host/api/v2', fetch: fetcher });
    expect(await client.execute(request)).toEqual(body);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('accepts an optional page without breaking existing row-only responses', async () => {
    for (const [body, expected] of [
      [
        { ok: true, data: { rows: [{ title: 'A' }] } },
        { ok: true, data: { rows: [{ title: 'A' }] } },
      ],
      [
        {
          ok: true,
          data: { rows: [{ title: 'A' }], page: { limit: 1, offset: 0, total: 7 } },
        },
        {
          ok: true,
          data: { rows: [{ title: 'A' }], page: { limit: 1, offset: 0, total: 7 } },
        },
      ],
    ] as const) {
      const client = createDataQueryHttpClient({
        baseUrl: 'https://host/api/v2',
        fetch: async () => Response.json(body),
      });
      expect(await client.execute(request)).toEqual(expected);
    }
    for (const page of [
      { limit: 1, offset: 0 },
      { limit: 1, offset: 0, total: -1 },
      { limit: 0, offset: 0, total: 1 },
    ]) {
      const client = createDataQueryHttpClient({
        baseUrl: 'https://host/api/v2',
        fetch: async () => Response.json({ ok: true, data: { rows: [], page } }),
      });
      expect(await client.execute(request)).toMatchObject({
        ok: false,
        error: { code: 'data_query.invalid_response' },
      });
    }
  });

  it('sanitizes network and credential-provider exceptions', async () => {
    for (const headers of [
      undefined,
      () => {
        throw new Error('credential secret');
      },
    ]) {
      const fetcher = vi.fn<typeof fetch>(async () => {
        throw new Error('https://host?token=secret ECONNREFUSED');
      });
      const client = createDataQueryHttpClient({
        baseUrl: 'https://host/api/v2',
        headers,
        fetch: fetcher,
      });
      expect(await client.execute(request)).toEqual({
        ok: false,
        error: {
          code: 'data_query.transport_failed',
          message: 'Unable to reach data query endpoint',
          tags: ['infrastructure'],
        },
      });
      expect(fetcher.mock.calls.length).toBe(headers ? 0 : 1);
    }
  });

  it.each([
    ['<html>proxy password=secret</html>', 502],
    ['{"ok":true,"data":', 200],
    [JSON.stringify({ rows: [] }), 200],
    [JSON.stringify({ ok: true, data: { rows: [] }, sql: 'SELECT secret' }), 200],
    [JSON.stringify({ ok: true, data: { rows: 'secret' } }), 200],
    [JSON.stringify({ ok: true, data: { rows: [] } }), 500],
    [
      JSON.stringify({ ok: false, error: { code: 'server.error', message: 'secret', tags: [] } }),
      200,
    ],
    [
      JSON.stringify({
        ok: false,
        error: { code: 'server.error', message: 'secret', tags: [], stack: 'secret' },
      }),
      500,
    ],
  ])('rejects non-protocol, malformed, or status-inconsistent responses', async (body, status) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(body, { status }));
    const client = createDataQueryHttpClient({ baseUrl: 'https://host/api/v2', fetch: fetcher });
    expect(await client.execute(request)).toEqual({
      ok: false,
      error: {
        code: 'data_query.invalid_response',
        message: 'Invalid data query response',
        tags: ['unexpected'],
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects runtime authority fields and never sends them over the wire', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createDataQueryHttpClient({ baseUrl: 'https://host/api/v2', fetch: fetcher });
    const contaminated = { ...request, contextParameters: { tenant: 'attacker' } };
    expect(await client.execute(contaminated)).toEqual({
      ok: false,
      error: {
        code: 'data_query.invalid_request',
        message: 'Invalid data query request',
        tags: ['validation'],
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
