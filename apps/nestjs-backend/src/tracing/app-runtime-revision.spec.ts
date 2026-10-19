/* eslint-disable @typescript-eslint/naming-convention -- OpenTelemetry attribute keys are dotted. */
import 'reflect-metadata';

import { AsyncLocalStorage } from 'node:async_hooks';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { context } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { ClsService } from 'nestjs-cls';
import { lastValueFrom, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IClsStore } from '../types/cls';
import {
  APP_RUNTIME_REVISION_ENV_KEY,
  APP_RUNTIME_REVISION_HEADER,
  appRuntimeRevisionAttributes,
  appRuntimeRevisionEnv,
} from './app-runtime-revision';
import { RouteTracingInterceptor } from './route-tracing.interceptor';

class QueryController {
  execute() {
    return { rows: [] };
  }
}

const savedCommit = 'a'.repeat(40);
const workspaceCommit = 'b'.repeat(40);
const encodeRevision = (value: object): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

const savedHeader = appRuntimeRevisionEnv({
  runtime: 'published',
  source: 'saved',
  version: 3,
  commitSha: savedCommit,
})[APP_RUNTIME_REVISION_ENV_KEY];

describe('App runtime revision attribution', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;
  let cls: ClsService<IClsStore>;

  beforeEach(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    cls = new ClsService<IClsStore>(new AsyncLocalStorage());
  });

  afterEach(async () => {
    context.disable();
    await provider.shutdown();
  });

  const captureRequest = async (header: unknown, appId?: string) => {
    const interceptor = new RouteTracingInterceptor(undefined, cls);
    const request = {
      method: 'POST',
      protocol: 'http',
      url: '/api/v2/queries/execute',
      route: { path: '/api/v2/queries/execute' },
      headers: { [APP_RUNTIME_REVISION_HEADER]: header },
      get: () => 'example.test',
    };
    const headers = new Map<string, unknown>();
    const response = {
      statusCode: 200,
      setHeader: (key: string, value: unknown) => headers.set(key, value),
    };
    const executionContext = new ExecutionContextHost(
      [request, response],
      QueryController,
      QueryController.prototype.execute
    );
    return provider.getTracer('app-revision-test').startActiveSpan('request', async (span) => {
      try {
        await cls.run(async () => {
          cls.set('user.id', 'usrFixtureOwner');
          if (appId) cls.set('appId', appId);
          await Promise.resolve();
          await lastValueFrom(
            interceptor.intercept(executionContext, { handle: () => of(undefined) })
          );
        });
        return span.spanContext().spanId;
      } finally {
        span.end();
      }
    });
  };

  it('ignores App provenance for non-App principals and never takes App identity from headers', async () => {
    const spoofed = encodeRevision({
      ...JSON.parse(Buffer.from(savedHeader, 'base64url').toString('utf8')),
      appId: 'appImpersonated',
    });
    const normalSpanId = await captureRequest(spoofed);
    const appSpanId = await captureRequest(spoofed, 'appAuthenticated');
    const normal = exporter
      .getFinishedSpans()
      .find((span) => span.spanContext().spanId === normalSpanId)!;
    const app = exporter
      .getFinishedSpans()
      .find((span) => span.spanContext().spanId === appSpanId)!;
    expect(normal.attributes['teable.user.is_app']).toBe(false);
    expect(normal.attributes).not.toHaveProperty('teable.app.version');
    expect(normal.attributes).not.toHaveProperty('teable.app.runtime');
    expect(app.attributes['teable.app.id']).toBe('appAuthenticated');
    expect(app.attributes['teable.app.version']).toBe(3);
    expect(Object.values(app.attributes)).not.toContain('appImpersonated');
  });

  it('keeps an older published revision separate from a concurrently edited preview of the same App', async () => {
    const workspace = appRuntimeRevisionEnv({
      runtime: 'preview',
      source: 'workspace',
      baseVersion: 8,
      baseCommitSha: workspaceCommit,
    })[APP_RUNTIME_REVISION_ENV_KEY];
    const [publishedId, previewId] = await Promise.all([
      captureRequest(savedHeader, 'appConcurrent'),
      captureRequest(workspace, 'appConcurrent'),
    ]);
    const published = exporter
      .getFinishedSpans()
      .find((span) => span.spanContext().spanId === publishedId)!;
    const preview = exporter
      .getFinishedSpans()
      .find((span) => span.spanContext().spanId === previewId)!;
    expect(published.attributes).toMatchObject({
      'teable.app.version': 3,
      'teable.app.commit_sha': savedCommit,
      'teable.app.source': 'saved',
    });
    expect(published.attributes).not.toHaveProperty('teable.app.base_version');
    expect(preview.attributes).toMatchObject({
      'teable.app.base_version': 8,
      'teable.app.base_commit_sha': workspaceCommit,
      'teable.app.source': 'workspace',
    });
    expect(preview.attributes).not.toHaveProperty('teable.app.version');
    expect(preview.attributes).not.toHaveProperty('teable.app.commit_sha');
  });

  it.each([
    '{',
    'x'.repeat(513),
    [savedHeader, savedHeader],
    encodeRevision({ runtime: 'published', source: 'saved', version: '3' }),
    encodeRevision({ runtime: 'published', source: 'saved', version: Number.MAX_SAFE_INTEGER + 1 }),
    encodeRevision({ runtime: 'published', source: 'saved', version: 1.5 }),
    encodeRevision({ runtime: 'published', source: 'saved', version: 0 }),
    encodeRevision({
      runtime: 'published',
      source: 'saved',
      version: 3,
      commitSha: 'archive-token',
    }),
    encodeRevision({ runtime: 'published', source: 'workspace', baseVersion: 3 }),
  ])('ignores malformed or ambiguous runtime provenance: %#', (header) => {
    expect(appRuntimeRevisionAttributes(header)).toBeUndefined();
  });

  it('does not fabricate a saved revision for an unversioned workspace or expose an archive token', () => {
    const header = appRuntimeRevisionEnv({
      runtime: 'preview',
      source: 'workspace',
      baseVersion: 0,
      baseCommitSha: 'private-archive-token',
    })[APP_RUNTIME_REVISION_ENV_KEY];
    expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))).toEqual({
      runtime: 'preview',
      source: 'workspace',
    });
    const attributes = appRuntimeRevisionAttributes(header);
    expect(attributes).not.toHaveProperty('teable.app.base_version');
    expect(attributes).not.toHaveProperty('teable.app.base_commit_sha');
  });
});
