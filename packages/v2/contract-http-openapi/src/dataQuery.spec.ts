import {
  ActorId,
  domainError,
  NoopLogger,
  RecordQueryPluginRunner,
  type IExecutionContext,
} from '@teable/v2-core';
import {
  DataQueryService,
  QueryExecutionService,
  type ExecuteDataQueryRequest,
} from '@teable/v2-data-query';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { createDataQueryFetchHandler, type DataQueryFetchHandler } from './dataQuery';
import { generateV2OpenApiDocument } from './generate';

const input: ExecuteDataQueryRequest = {
  definition: {
    version: 1,
    kind: 'records',
    tableId: `tbl${'a'.repeat(16)}`,
    select: [{ fieldId: `fld${'b'.repeat(16)}`, alias: 'title' }],
  },
};
const context: IExecutionContext = {
  actorId: ActorId.create('reader')._unsafeUnwrap(),
};

const post = (body: unknown) =>
  new Request('https://host/queries/execute', {
    method: 'POST',
    headers: new Headers([
      ['Authorization', 'Bearer secret'],
      ['Content-Type', 'application/json'],
    ]),
    body: JSON.stringify(body),
  });

const responseOf = async (handler: DataQueryFetchHandler, request: Request) => {
  const result = await handler.handle(request);
  if (!result.matched) throw new Error('Expected route match');
  return result.response;
};

describe('generated data-query OpenAPI contract', () => {
  it('publishes validation only with opt-in and rejects execution input/output at that route', async () => {
    const hidden = await generateV2OpenApiDocument();
    expect(hidden.paths?.['/queries/validate']).toBeUndefined();
    const document = await generateV2OpenApiDocument({ includeDataQuery: true });
    const operation = document.paths?.['/queries/validate']?.post;
    const request = operation?.requestBody;
    const response = operation?.responses?.['200'];
    if (!request || '$ref' in request || !response || '$ref' in response)
      throw new Error('Missing validation schemas');
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    const acceptsRequest = ajv.compile(request.content['application/json'].schema!);
    const acceptsResponse = ajv.compile(response.content!['application/json'].schema!);
    expect(acceptsRequest(input)).toBe(true);
    expect(acceptsRequest({ ...input, parameters: {} })).toBe(false);
    expect(
      acceptsResponse({
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
      })
    ).toBe(true);
    expect(acceptsResponse({ ok: true, data: { rows: [] } })).toBe(false);
  });
  it('lets consumers validate recursive inline requests and result envelopes', async () => {
    const document = await generateV2OpenApiDocument({ includeDataQuery: true });
    const operation = document.paths?.['/queries/execute']?.post;
    const request = operation?.requestBody;
    if (!request || '$ref' in request) throw new Error('Missing query request body');
    const requestSchema = request.content['application/json']?.schema;
    if (!requestSchema) throw new Error('Missing query request schema');
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    // Ajv is a JSON Schema validator, not an OpenAPI loader: register nested schema resources.
    ajv.addSchema(requestSchema);
    const success = operation?.responses?.['200'];
    if (!success || '$ref' in success) throw new Error('Missing success response');
    const successSchema = success.content?.['application/json']?.schema;
    if (!successSchema) throw new Error('Missing success response schema');
    ajv.addSchema(successSchema);
    ajv.addSchema(document, 'urn:teable:openapi-test');
    const acceptsRequest = ajv.compile({
      $ref: 'urn:teable:openapi-test#/paths/~1queries~1execute/post/requestBody/content/application~1json/schema',
    });
    const inline = {
      definition: {
        version: 1,
        kind: 'records',
        tableId: `tbl${'a'.repeat(16)}`,
        select: [{ fieldId: `fld${'b'.repeat(16)}`, alias: 'title' }],
        parameters: { minimum: { type: 'number' } },
      },
      parameters: { minimum: 10 },
    };
    expect(acceptsRequest(inline)).toBe(true);
    expect(acceptsRequest(input)).toBe(true);
    for (const invalid of [
      {},
      { ...inline, reference: { libraryId: 'removed' } },
      { ...inline, actorId: 'admin' },
      { ...inline, contextParameters: { tenant: 'forged' } },
      { ...inline, scope: { allowAll: true } },
      { definition: { ...inline.definition, sql: 'SELECT secret' } },
      {
        reference: {
          libraryId: 'removed',
          queryId: `qry${'a'.repeat(16)}`,
          revision: { mode: 'latest' },
        },
      },
      {
        definition: {
          ...inline.definition,
          parameters: { minimum: { type: 'number', source: 'context' } },
        },
      },
    ]) {
      expect(acceptsRequest(invalid)).toBe(false);
    }
    const nested = {
      ...inline,
      definition: {
        ...inline.definition,
        filter: {
          conjunction: 'and',
          items: [{ not: { fieldId: `fld${'b'.repeat(16)}`, operator: 'is', value: 'sample' } }],
        },
      },
    };
    expect(acceptsRequest(nested)).toBe(true);
    expect(
      acceptsRequest({
        ...nested,
        definition: { ...nested.definition, filter: { not: { invalid: true } } },
      })
    ).toBe(false);
    const responseSchema = (status: string) => {
      const response = operation?.responses?.[status];
      if (!response || '$ref' in response) throw new Error(`Missing response ${status}`);
      const schema = response.content?.['application/json']?.schema;
      if (!schema) throw new Error(`Missing response schema ${status}`);
      return {
        $ref: `urn:teable:openapi-test#/paths/~1queries~1execute/post/responses/${status}/content/application~1json/schema`,
      };
    };
    const acceptsSuccess = ajv.compile(responseSchema('200'));
    expect(acceptsSuccess({ ok: true, data: { rows: [{ title: 'Alpha', amount: 10 }] } })).toBe(
      true
    );
    expect(
      acceptsSuccess({ ok: true, data: { rows: [{ optional: null, nested: ['value'] }] } })
    ).toBe(true);
    for (const invalid of [
      { ok: true },
      { ok: true, data: { rows: 'not an array' } },
      { ok: false, data: { rows: [] } },
    ]) {
      expect(acceptsSuccess(invalid)).toBe(false);
    }
    const acceptsError = ajv.compile(responseSchema('400'));
    expect(
      acceptsError({
        ok: false,
        error: {
          code: 'data_query.invalid_request',
          message: 'Invalid request',
          tags: ['validation'],
        },
      })
    ).toBe(true);
    expect(acceptsError({ ok: false, error: 'Invalid request' })).toBe(false);
  });
});

describe('opt-in data query Fetch adapter', () => {
  it('authenticates validation and returns descriptions without executing', async () => {
    const execute = vi.fn(async () => ok({ rows: [] }));
    const validate = vi.fn(async () =>
      ok({
        outputs: [
          {
            alias: 'title',
            cellValueType: 'string',
            wireType: 'string' as const,
            isMultipleCellValue: false,
            nullable: true,
          },
        ],
      })
    );
    const authenticate = vi.fn(() => context);
    const handler = createDataQueryFetchHandler({
      service: { execute, validate },
      createExecutionContext: authenticate,
    });
    const request = new Request('https://host/queries/validate', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    const response = await responseOf(handler, request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
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
    });
    expect(authenticate).toHaveBeenCalledWith(request);
    expect(validate).toHaveBeenCalledWith(context, input);
    expect(execute).not.toHaveBeenCalled();
  });
  it('does not mount the API root or old SQL route and rejects unsupported methods', async () => {
    const execute = vi.fn(async () => ok({ rows: [] }));
    const authenticate = vi.fn(() => context);
    const handler = createDataQueryFetchHandler({
      service: { validate: vi.fn(async () => ok({ outputs: [] })), execute },
      createExecutionContext: authenticate,
    });
    for (const path of ['/api/v2/queries/execute', '/sql-query', '/queries/execute/']) {
      expect(await handler.handle(new Request(`https://host${path}`))).toEqual({ matched: false });
    }
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      const response = await responseOf(
        handler,
        new Request('https://host/queries/execute', { method })
      );
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('POST');
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: 'data_query.method_not_allowed' },
      });
    }
    expect(authenticate).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { ...input, reference: { libraryId: 'removed' } },
    { ...input, actorId: 'admin' },
    { ...input, groups: ['admin'] },
    { ...input, scope: { allowAll: true } },
    { ...input, contextParameters: { tenant: 'attacker' } },
    { ...input, sql: 'SELECT secret FROM accounts' },
    {
      reference: {
        libraryId: 'removed',
        queryId: `qry${'a'.repeat(16)}`,
        revision: { mode: 'latest' },
      },
    },
  ])(
    'rejects obsolete input or body-derived authority at the shared boundary: %j',
    async (body) => {
      const service = new QueryExecutionService(
        new DataQueryService(
          {
            findOne: async () => {
              throw new Error('Invalid requests must not load metadata');
            },
          },
          new RecordQueryPluginRunner([], new NoopLogger()),
          {
            execute: async () => {
              throw new Error('Invalid requests must not execute');
            },
          }
        )
      );
      const handler = createDataQueryFetchHandler({
        service,
        createExecutionContext: () => context,
      });
      const response = await responseOf(handler, post(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        ok: false,
        error: {
          code: 'data_query.invalid_request',
          message: 'Provide a query definition and optional public parameters',
          tags: ['validation'],
        },
      });
    }
  );

  it('rejects malformed JSON without reflecting its body', async () => {
    const execute = vi.fn(async () => ok({ rows: [] }));
    const handler = createDataQueryFetchHandler({
      service: { validate: vi.fn(async () => ok({ outputs: [] })), execute },
      createExecutionContext: () => context,
    });
    const response = await responseOf(
      handler,
      new Request('https://host/queries/execute', {
        method: 'POST',
        body: '{"password":"secret"',
      })
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('secret');
    expect(execute).not.toHaveBeenCalled();
  });

  it('sanitizes authentication exceptions and never executes unauthenticated requests', async () => {
    const execute = vi.fn(async () => ok({ rows: [] }));
    const handler = createDataQueryFetchHandler({
      service: { validate: vi.fn(async () => ok({ outputs: [] })), execute },
      createExecutionContext: () => {
        throw new Error('Bearer secret password');
      },
    });
    const response = await responseOf(handler, post(input));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: 'data_query.context_failed',
        message: 'Unable to resolve data query execution context',
        tags: ['unexpected'],
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    [domainError.unauthorized({ message: 'Bearer secret' }), 401, 'data_query.unauthorized'],
    [domainError.forbidden({ message: 'Tenant secret policy' }), 403, 'data_query.forbidden'],
  ] as const)(
    'sanitizes typed authentication denials while preserving status',
    async (error, status, code) => {
      const execute = vi.fn(async () => ok({ rows: [] }));
      const handler = createDataQueryFetchHandler({
        service: { validate: vi.fn(async () => ok({ outputs: [] })), execute },
        createExecutionContext: () => {
          throw error;
        },
      });
      const response = await responseOf(handler, post(input));
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body).toMatchObject({ ok: false, error: { code } });
      expect(JSON.stringify(body)).not.toContain('secret');
      expect(execute).not.toHaveBeenCalled();
    }
  );

  it.each([
    [domainError.validation({ code: 'query.invalid', message: 'Invalid query' }), 400],
    [domainError.unauthorized({ code: 'query.unauthorized', message: 'Unauthorized' }), 401],
    [domainError.forbidden({ code: 'query.denied', message: 'Access denied' }), 403],
    [domainError.notFound({ code: 'query.missing', message: 'Query not found' }), 404],
  ] as const)(
    'maps returned domain errors to existing HTTP statuses: %j',
    async (error, status) => {
      const handler = createDataQueryFetchHandler({
        service: {
          validate: vi.fn(async () => ok({ outputs: [] })),
          execute: async () => err(error),
        },
        createExecutionContext: () => context,
      });
      const response = await responseOf(handler, post(input));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        ok: false,
        error: { code: error.code, message: error.message, tags: error.tags },
      });
    }
  );

  it.each([
    domainError.unexpected({
      message: 'Failed to load table: SELECT private_secret FROM tenants',
      details: { sql: 'private_secret' },
      localization: { i18nKey: 'httpErrors.user.notFound', context: { dsn: 'private_secret' } },
    }),
    domainError.infrastructure({
      message: 'Connection failed: private_secret',
      details: { connection: 'private_secret' },
    }),
    domainError.invariant({ message: 'Internal metadata invariant private_secret' }),
  ])('sanitizes returned internal domain failures at the public boundary', async (error) => {
    const handler = createDataQueryFetchHandler({
      service: {
        validate: vi.fn(async () => ok({ outputs: [] })),
        execute: async () => err(error),
      },
      createExecutionContext: () => context,
    });
    const response = await responseOf(handler, post(input));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, error: { code: 'data_query.execution_failed' } });
    expect(JSON.stringify(body)).not.toContain('private_secret');
    expect(body.error).not.toHaveProperty('details');
    expect(body.error).not.toHaveProperty('localization');
  });

  it('preserves timeout status and code without forwarding internal diagnostics', async () => {
    const handler = createDataQueryFetchHandler({
      service: {
        validate: vi.fn(async () => ok({ outputs: [] })),
        execute: async () =>
          err(
            domainError.infrastructure({
              code: 'data_query.timeout',
              message: 'private_secret',
              details: { sql: 'private_secret' },
            })
          ),
      },
      createExecutionContext: () => context,
    });
    const response = await responseOf(handler, post(input));
    expect(response.status).toBe(504);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, error: { code: 'data_query.timeout' } });
    expect(JSON.stringify(body)).not.toContain('private_secret');
  });

  it('rejects non-JSON execution output instead of producing a malformed success body', async () => {
    const handler = createDataQueryFetchHandler({
      service: {
        validate: vi.fn(async () => ok({ outputs: [] })),
        execute: async () => ok({ rows: [{ invalid: BigInt(1) }] }),
      },
      createExecutionContext: () => context,
    });
    const response = await responseOf(handler, post(input));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: 'data_query.invalid_response',
        message: 'Invalid data query response',
        tags: ['unexpected'],
      },
    });
  });

  it('sanitizes unexpected service exceptions', async () => {
    const handler = createDataQueryFetchHandler({
      service: {
        validate: vi.fn(async () => ok({ outputs: [] })),
        execute: async () => {
          throw new Error('SELECT password FROM secret; token=secret');
        },
      },
      createExecutionContext: () => context,
    });
    const response = await responseOf(handler, post(input));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: 'data_query.execution_failed',
        message: 'Unable to execute data query',
        tags: ['unexpected'],
      },
    });
  });
});
