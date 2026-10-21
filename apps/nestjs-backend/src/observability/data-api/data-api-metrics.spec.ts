import { EventEmitter } from 'node:events';
import http from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  InternalServerErrorException,
  Logger,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { metrics } from '@opentelemetry/api';
import { metrics as sdkMetrics } from '@opentelemetry/sdk-node';
import { type Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataApiMetricsMiddleware } from './data-api-metrics.middleware';
import { DataApiMetricsModule } from './data-api-metrics.module';
import { DataApiMetricsService } from './data-api-metrics.service';

@Controller('api/table/:tableId/record')
class MetricsTestController {
  @Get('recSuccess')
  success(@Res({ passthrough: true }) response: Response) {
    response.setHeader('x-teable-v2', 'true');
    return { id: 'recSuccess' };
  }

  @Get('recFailure')
  failure() {
    throw new InternalServerErrorException();
  }

  @Get('recForbidden')
  @UseGuards({
    canActivate: () => {
      throw new ForbiddenException();
    },
  })
  forbidden() {
    return {};
  }

  @Get('recThrottled')
  throttled() {
    throw new HttpException('Rate limited', 429);
  }
}

const recordPath = '/api/table/tblFixture/record';

describe('Data API reliability metrics', () => {
  let provider: InstanceType<typeof sdkMetrics.MeterProvider>;
  let exporter: InstanceType<typeof sdkMetrics.InMemoryMetricExporter>;
  let service: DataApiMetricsService;
  let middleware: DataApiMetricsMiddleware;
  let app: INestApplication | undefined;

  beforeEach(() => {
    vi.stubEnv('DATA_API_OBSERVER_TABLE_IDS', '');
    metrics.disable();
    exporter = new sdkMetrics.InMemoryMetricExporter(sdkMetrics.AggregationTemporality.CUMULATIVE);
    provider = new sdkMetrics.MeterProvider({
      readers: [
        new sdkMetrics.PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60000 }),
      ],
    });
    metrics.setGlobalMeterProvider(provider);
    service = new DataApiMetricsService();
    middleware = new DataApiMetricsMiddleware(service);
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    service.onModuleDestroy();
    await provider.shutdown();
    metrics.disable();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const response = (statusCode = 200, version?: string) =>
    Object.assign(new EventEmitter(), {
      statusCode,
      writableFinished: false,
      getHeader: vi.fn().mockReturnValue(version),
    });

  const start = (method: string, path: string, res: ReturnType<typeof response>) => {
    const next = vi.fn();
    middleware.use({ method, originalUrl: path } as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
    return res;
  };

  const points = async (name: string) => {
    exporter.reset();
    await provider.forceFlush();
    return (
      exporter
        .getMetrics()
        .at(-1)
        ?.scopeMetrics.flatMap((scope) => scope.metrics)
        .filter((metric) => metric.descriptor.name === name)
        .flatMap((metric) =>
          metric.dataPoints.map(({ attributes, value }) => ({ attributes, value }))
        ) ?? []
    );
  };

  it.each([
    ['GET', '', 'list'],
    ['GET', '/recFixture', 'get'],
    ['POST', '', 'create'],
    ['PATCH', '/recFixture', 'update'],
    ['PATCH', '', 'update_many'],
    ['DELETE', '/recFixture', 'delete'],
    ['DELETE', '', 'delete_many'],
    ['POST', '/form-submit', 'form_submit'],
    ['POST', '/recFixture/duplicate', 'duplicate'],
  ])('counts %s %s once without exporting identifiers', async (method, suffix, operation) => {
    const res = start(
      method,
      `${recordPath}${suffix}/?filter=private-value`,
      response(200, 'true')
    );
    res.emit('finish');
    res.emit('close');
    expect(await points('teable.data_api.request.completed')).toMatchObject([
      { attributes: { operation, implementation: 'v2', outcome: 'success' }, value: 1 },
    ]);
    expect((await points('teable.data_api.request.completed'))[0].attributes).toEqual({
      operation,
      implementation: 'v2',
      outcome: 'success',
    });
    expect(await points('teable.data_api.request.active')).toMatchObject([{ value: 0 }]);
    expect(await points('teable.data_api.request.duration')).toMatchObject([
      { value: { count: 1, buckets: { boundaries: [25, 100, 250, 500, 1000, 2000, 5000] } } },
    ]);
    expect(res.listenerCount('finish') + res.listenerCount('close')).toBe(0);
  });

  it.each([
    ['GET', '/health'],
    ['GET', `${recordPath}/history`],
    ['GET', `${recordPath}/collaborators`],
    ['GET', `${recordPath}/recFixture/history`],
    ['POST', `${recordPath}/recFixture/fldFixture/uploadAttachment`],
    ['POST', `${recordPath}/duplicate`],
    ['OPTIONS', recordPath],
    ['HEAD', recordPath],
    ['PUT', recordPath],
    ['POST', `${recordPath}/recFixture`],
  ])('ignores unrelated %s %s', async (method, path) => {
    const res = start(method, path, response());
    expect(res.eventNames()).toHaveLength(0);
    expect(await points('teable.data_api.request.started')).toHaveLength(0);
  });

  it.each([
    [200, 'success'],
    [201, 'success'],
    [204, 'success'],
    [304, 'not_modified'],
    [400, 'client_error'],
    [401, 'client_error'],
    [403, 'client_error'],
    [404, 'client_error'],
    [409, 'client_error'],
    [429, 'throttled'],
    [499, 'aborted'],
    [500, 'server_error'],
    [503, 'server_error'],
    [100, 'unexpected'],
    [300, 'unexpected'],
    [301, 'unexpected'],
    [302, 'unexpected'],
    [303, 'unexpected'],
    [307, 'unexpected'],
    [308, 'unexpected'],
    [399, 'unexpected'],
  ])('classifies the final HTTP status %s as %s', async (status, outcome) => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const res = start('PATCH', `${recordPath}/recFixture`, response(200));
    res.statusCode = status;
    res.emit('finish');
    expect(await points('teable.data_api.request.completed')).toMatchObject([
      { attributes: { outcome, implementation: 'unknown' }, value: 1 },
    ]);
    // A served read (2xx, 304) is measured; every failure class must stay out of the tail.
    expect(await points('teable.data_api.request.duration')).toHaveLength(
      outcome === 'success' || outcome === 'not_modified' ? 1 : 0
    );
    // `unexpected` keeps its failure weight but gains a bounded, loggable location.
    const offContract = await points('teable.data_api.request.off_contract');
    expect(offContract).toHaveLength(outcome === 'unexpected' ? 1 : 0);
    if (outcome === 'unexpected') {
      expect(offContract).toEqual([
        {
          attributes: {
            operation: 'update',
            implementation: 'unknown',
            http_status: String(status),
          },
          value: 1,
        },
      ]);
      expect(warn).toHaveBeenCalledOnce();
      return;
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('excludes only server-configured observer tables from user SLI counts', async () => {
    vi.stubEnv('DATA_API_OBSERVER_TABLE_IDS', ' tblFixture, tblOtherObserver ');
    middleware = new DataApiMetricsMiddleware(service);
    const observer = start('GET', recordPath, response());
    expect(observer.eventNames()).toHaveLength(0);
    expect(await points('teable.data_api.request.started')).toHaveLength(0);
    const product = start('GET', '/api/table/tblFixtureExtra/record', response());
    product.emit('finish');
    expect(await points('teable.data_api.request.completed')).toMatchObject([{ value: 1 }]);
  });

  it('counts a premature close as unknown delivery, even with status 200', async () => {
    const res = start('PATCH', `${recordPath}/recFixture`, response());
    expect(await points('teable.data_api.request.active')).toMatchObject([{ value: 1 }]);
    res.emit('close');
    res.emit('finish');
    expect(await points('teable.data_api.request.completed')).toMatchObject([
      { attributes: { outcome: 'aborted' }, value: 1 },
    ]);
    expect(await points('teable.data_api.request.active')).toMatchObject([{ value: 0 }]);
    expect(await points('teable.data_api.request.duration')).toHaveLength(0);
  });

  it('uses final server attribution and accepts a fully flushed close', async () => {
    const res = start('GET', `${recordPath}/recFixture`, response(200, 'true'));
    res.getHeader.mockReturnValue('false');
    res.writableFinished = true;
    res.emit('close');
    expect(await points('teable.data_api.request.completed')).toMatchObject([
      { attributes: { implementation: 'v1', outcome: 'success' }, value: 1 },
    ]);
  });

  it('observes idle collectors without inventing successful requests', async () => {
    expect(await points('teable.data_api.observer.up')).toMatchObject([{ value: 1 }]);
    expect(await points('teable.data_api.request.completed')).toHaveLength(0);
  });

  it('keeps observer exceptions out of request and response handling', () => {
    vi.spyOn(service, 'recordStart').mockImplementationOnce(() => {
      throw new Error('observer');
    });
    const failedStart = start('GET', recordPath, response());
    expect(failedStart.eventNames()).toHaveLength(0);
    vi.spyOn(service, 'recordEnd').mockImplementationOnce(() => {
      throw new Error('observer');
    });
    const res = start('GET', recordPath, response());
    expect(() => res.emit('finish')).not.toThrow();
    expect(res.eventNames()).toHaveLength(0);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {
      throw new Error('observer');
    });
    const unexplained = start('GET', recordPath, response(302));
    expect(() => unexplained.emit('finish')).not.toThrow();
  });

  it('collapses repeated unexplained statuses into one line per window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const fire = (status: number) => {
      const res = start('GET', `${recordPath}/recFixture`, response(status));
      res.emit('finish');
    };

    fire(302);
    fire(302);
    fire(307);
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      'Data API response the contract does not explain: outcome=unexpected operation=get implementation=unknown http_status=302 reason=redirect suppressed_since_last_log=0',
      expect.stringContaining('http_status=307 reason=redirect'),
    ]);
    const offContract = await points('teable.data_api.request.off_contract');
    expect(offContract).toHaveLength(2);
    expect(offContract).toEqual(
      expect.arrayContaining([
        {
          attributes: { operation: 'get', implementation: 'unknown', http_status: '302' },
          value: 2,
        },
        {
          attributes: { operation: 'get', implementation: 'unknown', http_status: '307' },
          value: 1,
        },
      ])
    );

    vi.setSystemTime(Date.now() + 61_000);
    fire(302);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[2][0]).toContain('suppressed_since_last_log=1');
  });

  it('serves a conditional GET as 304 without counting it as a failure', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const module = await Test.createTestingModule({
      imports: [DataApiMetricsModule],
      controllers: [MetricsTestController],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    const { hostname, port } = new URL(await app.getUrl());

    const recordGet = (ifNoneMatch?: string) =>
      new Promise<{ status: number; etag?: string; body: string }>((resolve, reject) => {
        const headers: Record<string, string> = {};
        if (ifNoneMatch) {
          headers['if-none-match'] = ifNoneMatch;
        }
        const request = http.request(
          { hostname, port, path: `${recordPath}/recSuccess`, headers },
          (result) => {
            let body = '';
            result.setEncoding('utf8');
            result.on('data', (chunk: string) => (body += chunk));
            result.on('end', () =>
              resolve({ status: result.statusCode ?? 0, etag: result.headers.etag, body })
            );
          }
        );
        request.on('error', reject);
        request.end();
      });

    const first = await recordGet();
    expect(first.status).toBe(200);
    expect(first.etag).toBeTruthy();

    // Node's fetch marks conditional requests `no-cache`, which Express honors by resending
    // the body, so the revalidation that reaches the 304 path runs through node:http.
    const revalidated = await recordGet(first.etag);
    expect(revalidated.status).toBe(304);
    expect(revalidated.body).toBe('');

    const completed = await points('teable.data_api.request.completed');
    expect(completed).toHaveLength(2);
    expect(completed).toEqual(
      expect.arrayContaining([
        {
          attributes: { operation: 'get', implementation: 'v2', outcome: 'success' },
          value: 1,
        },
        {
          attributes: { operation: 'get', implementation: 'v2', outcome: 'not_modified' },
          value: 1,
        },
      ])
    );
    // Revalidation runs the same handler and serializer, so it stays in the histogram...
    expect((await points('teable.data_api.request.duration'))[0]).toMatchObject({
      value: { count: 2 },
    });
    // ...and never in the off-contract counter, its warning, or the active gauge.
    expect(await points('teable.data_api.request.off_contract')).toHaveLength(0);
    expect(await points('teable.data_api.request.active')).toMatchObject([{ value: 0 }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('registers in Nest and observes guards, thrown handlers and throttling without a tracer', async () => {
    const module = await Test.createTestingModule({
      imports: [DataApiMetricsModule],
      controllers: [MetricsTestController],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    const baseUrl = await app.getUrl();
    for (const [record, status] of [
      ['recSuccess', 200],
      ['recFailure', 500],
      ['recForbidden', 403],
      ['recThrottled', 429],
    ] as const) {
      const result = await fetch(`${baseUrl}${recordPath}/${record}`);
      await result.text();
      expect(result.status).toBe(status);
    }
    const completed = await points('teable.data_api.request.completed');
    expect(completed).toHaveLength(4);
    expect(completed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attributes: { operation: 'get', implementation: 'v2', outcome: 'success' },
          value: 1,
        }),
        expect.objectContaining({
          attributes: { operation: 'get', implementation: 'unknown', outcome: 'server_error' },
          value: 1,
        }),
        expect.objectContaining({
          attributes: { operation: 'get', implementation: 'unknown', outcome: 'client_error' },
          value: 1,
        }),
        expect.objectContaining({
          attributes: { operation: 'get', implementation: 'unknown', outcome: 'throttled' },
          value: 1,
        }),
      ])
    );
  });
});
