import http, { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import type { CallHandler, ExecutionContext, INestApplication } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { Test } from '@nestjs/testing';
import type { Span } from '@opentelemetry/api';
import { metrics, trace } from '@opentelemetry/api';
import { metrics as sdkMetrics } from '@opentelemetry/sdk-node';
import { BASE_SHARE_ID_HEADER, IS_TEMPLATE_HEADER, SHARE_VIEW_ID_HEADER } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { firstValueFrom, lastValueFrom, of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { V2DataQueryExplainController } from './v2-data-query-explain.controller';
import { V2DataQueryExplainService } from './v2-data-query-explain.service';
import { V2DataQueryObservabilityInterceptor } from './v2-data-query-observability.interceptor';
import { V2DataQueryController } from './v2-data-query.controller';
import { V2DataQueryService } from './v2-data-query.service';

// These services are replaced by useValue below; avoid loading their database containers.
vi.mock('./v2-data-query.service', () => ({
  V2DataQueryService: class V2DataQueryService {},
}));
vi.mock('./v2-data-query-explain.service', () => ({
  V2DataQueryExplainService: class V2DataQueryExplainService {},
}));

const counterName = 'teable.data_query.requests.total';
const durationName = 'teable.data_query.duration.ms';
const labels = (source: string, operation: string, outcome: string) => ({
  'teable.data_query.source': source,
  'teable.data_query.operation': operation,
  'teable.data_query.outcome': outcome,
});

describe('native query observability', () => {
  let app: INestApplication;
  let provider: InstanceType<typeof sdkMetrics.MeterProvider>;
  let exporter: InstanceType<typeof sdkMetrics.InMemoryMetricExporter>;
  let interceptor: V2DataQueryObservabilityInterceptor;
  const cls = { get: vi.fn() };
  const queries = { execute: vi.fn(), validate: vi.fn() };
  const explainer = { explain: vi.fn() };

  beforeEach(async () => {
    metrics.disable();
    exporter = new sdkMetrics.InMemoryMetricExporter(sdkMetrics.AggregationTemporality.CUMULATIVE);
    provider = new sdkMetrics.MeterProvider({
      readers: [
        new sdkMetrics.PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60000 }),
      ],
    });
    metrics.setGlobalMeterProvider(provider);
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined);
    cls.get.mockReset();
    for (const handler of [queries.execute, queries.validate, explainer.explain]) {
      handler.mockReset().mockResolvedValue({ status: 200, body: { ok: true, data: {} } });
    }
    const module = await Test.createTestingModule({
      controllers: [V2DataQueryController, V2DataQueryExplainController],
      providers: [
        V2DataQueryObservabilityInterceptor,
        { provide: ClsService, useValue: cls },
        { provide: V2DataQueryService, useValue: queries },
        { provide: V2DataQueryExplainService, useValue: explainer },
      ],
    }).compile();
    interceptor = module.get(V2DataQueryObservabilityInterceptor);
    app = module.createNestApplication({ logger: false });
    // Model the global authentication boundary: a telemetry header never authenticates a call.
    app.useGlobalGuards({
      canActivate(context) {
        if (context.switchToHttp().getRequest().headers.authorization !== 'Bearer fixture') {
          throw new UnauthorizedException();
        }
        return true;
      },
    });
    await app.listen(0, '127.0.0.1');
  });

  afterEach(async () => {
    await app?.close();
    await provider.shutdown();
    metrics.disable();
    vi.restoreAllMocks();
  });

  const points = async (name: string) => {
    exporter.reset();
    await provider.forceFlush();
    return exporter
      .getMetrics()
      .flatMap((resource) => resource.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .filter((metric) => metric.descriptor.name === name)
      .flatMap((metric) => metric.dataPoints)
      .map(({ attributes, value }) => ({ attributes, value }));
  };

  const post = async (
    operation = 'execute',
    headers: http.OutgoingHttpHeaders = {},
    body: unknown = { query: { tableId: 'tblPrivate', parameters: { secret: 'private' } } }
  ) => {
    const url = new URL(await app.getUrl());
    const { promise, resolve, reject } = Promise.withResolvers<{ status: number; body: unknown }>();
    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `/api/v2/queries/${operation}`,
        method: 'POST',
        headers: {
          authorization: 'Bearer fixture',
          'content-type': 'application/json',
          ...headers,
        },
      },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (raw += chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(raw) })
        );
      }
    );
    request.on('error', reject);
    request.end(JSON.stringify(body));
    return promise;
  };

  it('records all native operations without a span and preserves request/response semantics', async () => {
    const payload = { query: { tableId: 'tblPrivate' } };
    for (const operation of ['execute', 'validate', 'explain']) {
      expect(await post(operation, { 'x-teable-query-source': 'cli' }, payload)).toEqual({
        status: 200,
        body: { ok: true, data: {} },
      });
    }
    expect(queries.execute).toHaveBeenCalledWith(payload);
    expect(queries.validate).toHaveBeenCalledWith(payload, 'Bearer fixture');
    expect(explainer.explain).toHaveBeenCalledWith(payload);
    expect(await points(counterName)).toEqual(
      expect.arrayContaining(
        ['execute', 'validate', 'explain'].map((operation) => ({
          attributes: labels('cli', operation, 'success'),
          value: 1,
        }))
      )
    );
    const durations = await points(durationName);
    expect(durations).toHaveLength(3);
    for (const point of durations) expect(point.value).toMatchObject({ count: 1 });
  });

  it('uses canonical outcomes and thrown failures instead of treating HTTP 200 as success', async () => {
    queries.execute.mockResolvedValueOnce({
      status: 200,
      body: { ok: false, error: { code: 'data_query.invalid_request' } },
    });
    expect((await post()).body).toMatchObject({ ok: false });
    queries.execute.mockRejectedValueOnce(new Error('private failure details'));
    expect(await post()).toMatchObject({ status: 500, body: { ok: false } });
    queries.execute.mockResolvedValueOnce({ status: 500, body: { ok: true, data: {} } });
    expect((await post()).status).toBe(500);
    queries.execute.mockResolvedValueOnce({ status: 200, body: { unrelated: true } });
    expect((await post()).status).toBe(200);
    expect(await points(counterName)).toEqual([
      { attributes: labels('unknown', 'execute', 'error'), value: 4 },
    ]);
    expect(await points(durationName)).toMatchObject([{ value: { count: 4 } }]);
  });

  it.each(['mcp', 'cuppy_chat', 'cuppyclaw', 'cli', 'app', 'automation'])(
    'accepts bounded source %s over HTTP',
    async (source) => {
      await post('execute', { 'x-teable-query-source': source });
      expect(await points(counterName)).toEqual([
        { attributes: labels(source, 'execute', 'success'), value: 1 },
      ]);
    }
  );

  it.each([undefined, 'untrusted', '__proto__', 'cli/1.0', 'mcp, cli', ['mcp', 'mcp']])(
    'normalizes absent, invalid and repeated source %j to unknown',
    async (source) => {
      await post('execute', {
        ...(source === undefined ? {} : { 'x-teable-query-source': source }),
        'x-ai-internal': 'true',
        'x-teable-client': 'cli/1.0',
      });
      expect(await points(counterName)).toEqual([
        { attributes: labels('unknown', 'execute', 'success'), value: 1 },
      ]);
    }
  );

  it('gives authenticated App context precedence and keeps correlation IDs on spans only', async () => {
    cls.get.mockImplementation((key: string) => (key === 'appId' ? 'appAuthenticated' : undefined));
    const setAttribute = vi.fn();
    vi.mocked(trace.getActiveSpan).mockReturnValue({ setAttribute } as unknown as Span);
    await post('execute', {
      'x-teable-query-source': 'mcp',
      'x-teable-chat-id': 'chat-123',
      'x-teable-generation-id': 'generation_456',
      'x-teable-tool-call-id': 'tool:789',
      'x-teable-chat-message-id': 'message.123',
    });
    expect(setAttribute.mock.calls).toEqual(
      expect.arrayContaining([
        ['teable.data_query.source', 'app'],
        ['teable.chat.id', 'chat-123'],
        ['teable.generation.id', 'generation_456'],
        ['teable.tool_call.id', 'tool:789'],
        ['teable.chat_message.id', 'message.123'],
      ])
    );
    expect(await points(counterName)).toEqual([
      { attributes: labels('app', 'execute', 'success'), value: 1 },
    ]);
    expect((await points(durationName))[0].attributes).toEqual(labels('app', 'execute', 'success'));
    expect(JSON.stringify(setAttribute.mock.calls)).not.toContain('tblPrivate');
    expect(JSON.stringify(setAttribute.mock.calls)).not.toContain('secret');
    expect(JSON.stringify(setAttribute.mock.calls)).not.toContain('appAuthenticated');
  });

  it('drops invalid, oversized and multiple correlation IDs without affecting the query', async () => {
    const setAttribute = vi.fn();
    vi.mocked(trace.getActiveSpan).mockReturnValue({ setAttribute } as unknown as Span);
    await post('execute', {
      'x-teable-chat-id': ['chat1', 'chat2'],
      'x-teable-generation-id': 'x'.repeat(129),
      'x-teable-tool-call-id': 'private value',
      'x-teable-chat-message-id': 'message,extra',
    });
    expect(setAttribute.mock.calls).toEqual([
      ['teable.data_query.source', 'unknown'],
      ['teable.data_query.operation', 'execute'],
      ['teable.data_query.outcome', 'success'],
    ]);
    expect(queries.execute).toHaveBeenCalledOnce();
    expect(await points(counterName)).toEqual([
      { attributes: labels('unknown', 'execute', 'success'), value: 1 },
    ]);
  });

  it('does not count authentication rejections or grant authority from source metadata', async () => {
    expect(
      await post('execute', { authorization: '', 'x-teable-query-source': 'app' })
    ).toMatchObject({
      status: 401,
      body: { ok: false },
    });
    expect(queries.execute).not.toHaveBeenCalled();
    expect(await points(counterName)).toHaveLength(0);
    expect(await points(durationName)).toHaveLength(0);
  });

  it.each([BASE_SHARE_ID_HEADER, SHARE_VIEW_ID_HEADER, IS_TEMPLATE_HEADER])(
    'preserves native rejection of share/template header %s',
    async (header) => {
      for (const operation of ['execute', 'validate', 'explain']) {
        expect(await post(operation, { [header]: 'share-fixture' })).toMatchObject({
          status: 403,
          body: { ok: false },
        });
      }
      expect(queries.execute).not.toHaveBeenCalled();
      expect(queries.validate).not.toHaveBeenCalled();
      expect(explainer.explain).not.toHaveBeenCalled();
      expect(await points(counterName)).toHaveLength(3);
      for (const point of await points(counterName)) {
        expect(point.attributes['teable.data_query.outcome']).toBe('error');
        expect(point.value).toBe(1);
      }
    }
  );

  const observableContext = () => {
    const request = new IncomingMessage(new Socket());
    const response = new ServerResponse(request);
    const context = new ExecutionContextHost(
      [request, response],
      V2DataQueryController,
      V2DataQueryController.prototype.execute
    );
    context.setType('http');
    return { context: context as ExecutionContext, response };
  };

  it.each(['unsubscribe', 'close'] as const)(
    'records cancellation once on observable %s, including a later handler completion',
    async (terminal) => {
      const { context, response } = observableContext();
      const body = new Subject<unknown>();
      const subscription = interceptor.intercept(context, { handle: () => body }).subscribe();
      if (terminal === 'close') response.emit('close');
      else subscription.unsubscribe();
      body.next({ ok: true });
      body.complete();
      subscription.unsubscribe();
      response.emit('close');
      expect(response.listenerCount('close')).toBe(0);
      expect(await points(counterName)).toEqual([
        { attributes: labels('unknown', 'execute', 'cancelled'), value: 1 },
      ]);
      expect(await points(durationName)).toMatchObject([{ value: { count: 1 } }]);
    }
  );

  it('counts a response closed before interception as cancelled without changing the handler result', async () => {
    const { context, response } = observableContext();
    response.destroy();
    response.emit('close');
    const body = { ok: true, data: {} };

    expect(await lastValueFrom(interceptor.intercept(context, { handle: () => of(body) }))).toEqual(
      body
    );
    response.emit('close');
    expect(response.listenerCount('close')).toBe(0);
    expect(await points(counterName)).toEqual([
      { attributes: labels('unknown', 'execute', 'cancelled'), value: 1 },
    ]);
    expect(await points(durationName)).toMatchObject([{ value: { count: 1 } }]);
  });

  it('records a synchronous handler throw once and propagates it unchanged', async () => {
    const { context, response } = observableContext();
    const failure = new Error('handler failure');
    const next: CallHandler = {
      handle: () => {
        throw failure;
      },
    };
    await expect(firstValueFrom(interceptor.intercept(context, next))).rejects.toBe(failure);
    response.emit('close');
    expect(await points(counterName)).toEqual([
      { attributes: labels('unknown', 'execute', 'error'), value: 1 },
    ]);
  });

  it('does not record again when the response closes after successful observable completion', async () => {
    const { context, response } = observableContext();
    await lastValueFrom(interceptor.intercept(context, { handle: () => of({ ok: true }) }));
    response.emit('close');
    expect(await points(counterName)).toEqual([
      { attributes: labels('unknown', 'execute', 'success'), value: 1 },
    ]);
  });
});
