import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TEABLE_REQUEST_ATTRIBUTION,
  V2IndicatorInterceptor,
  X_TEABLE_V2_FEATURE_HEADER,
  X_TEABLE_V2_HEADER,
  X_TEABLE_V2_REASON_HEADER,
} from './v2-indicator.interceptor';

const { getActiveSpan, sentryScope } = vi.hoisted(() => ({
  getActiveSpan: vi.fn(),
  sentryScope: { setTag: vi.fn() },
}));

vi.mock('@opentelemetry/api', async () => {
  const actual = await vi.importActual<typeof import('@opentelemetry/api')>('@opentelemetry/api');
  return {
    ...actual,
    trace: {
      ...actual.trace,
      getActiveSpan,
    },
  };
});

vi.mock('@sentry/nestjs', () => ({
  getCurrentScope: () => sentryScope,
  getIsolationScope: () => sentryScope,
  getCurrentHub: () => ({ getScope: () => sentryScope }),
}));

describe('V2IndicatorInterceptor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records request attribution separately from v2 route tags', () => {
    const setAttributes = vi.fn();
    getActiveSpan.mockReturnValue({ setAttributes });

    const cls = {
      get: vi.fn((key: string) => {
        const values: Record<string, unknown> = {
          useV2: true,
          v2Reason: 'canary',
          v2Feature: 'createRecord',
        };
        return values[key];
      }),
    };

    const response = { setHeader: vi.fn() };
    const request = {
      method: 'POST',
      path: '/api/table/tbl123/record',
      params: { tableId: 'tbl123' },
    };
    const context = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
    const next = { handle: () => of('ok') } as CallHandler;

    const interceptor = new V2IndicatorInterceptor(cls as never);
    interceptor.intercept(context, next).subscribe();

    expect(response.setHeader).toHaveBeenCalledWith(X_TEABLE_V2_HEADER, 'true');
    expect(response.setHeader).toHaveBeenCalledWith(X_TEABLE_V2_REASON_HEADER, 'canary');
    expect(response.setHeader).toHaveBeenCalledWith(X_TEABLE_V2_FEATURE_HEADER, 'createRecord');
    expect(setAttributes).toHaveBeenCalledWith({
      [TEABLE_REQUEST_ATTRIBUTION]: 'v2',
      'teable.v2.enabled': true,
      'teable.v2.reason': 'canary',
      'teable.v2.feature': 'createRecord',
    });
    expect(sentryScope.setTag).toHaveBeenCalledWith(TEABLE_REQUEST_ATTRIBUTION, 'v2');
  });

  it('uses the final cls state after controller fallback', () => {
    const values: Record<string, unknown> = {
      useV2: true,
      v2Reason: 'canary',
      v2Feature: 'importCsv',
    };
    const cls = {
      get: vi.fn((key: string) => values[key]),
    };

    const response = { setHeader: vi.fn() };
    const request = {
      method: 'POST',
      path: '/api/import/bse123',
      params: {},
    };
    const context = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
    const next = {
      handle: () => {
        values.useV2 = false;
        values.v2Reason = 'unsupported_feature';
        return of('ok');
      },
    } as CallHandler;

    const interceptor = new V2IndicatorInterceptor(cls as never);
    interceptor.intercept(context, next).subscribe();

    expect(response.setHeader).toHaveBeenCalledWith(X_TEABLE_V2_HEADER, 'false');
    expect(response.setHeader).toHaveBeenCalledWith(
      X_TEABLE_V2_REASON_HEADER,
      'unsupported_feature'
    );
    expect(response.setHeader).toHaveBeenCalledWith(X_TEABLE_V2_FEATURE_HEADER, 'importCsv');
  });

  it('stamps the guard attribution before a handler error', () => {
    const cls = {
      get: vi.fn((key: string) => {
        const values: Record<string, unknown> = {
          useV2: true,
          v2Reason: 'space_feature',
          v2Feature: 'deleteField',
        };
        return values[key];
      }),
    };

    const response = { setHeader: vi.fn() };
    const context = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          method: 'DELETE',
          path: '/api/table/tbl123/field',
          params: { tableId: 'tbl123' },
        }),
      }),
    } as unknown as ExecutionContext;
    const exception = new Error('delete failed');
    const next = { handle: () => throwError(() => exception) } as CallHandler;

    const interceptor = new V2IndicatorInterceptor(cls as never);
    interceptor.intercept(context, next).subscribe({ error: () => undefined });

    expect(response.setHeader).toHaveBeenCalledWith(X_TEABLE_V2_HEADER, 'true');
    expect(response.setHeader).toHaveBeenCalledWith(X_TEABLE_V2_REASON_HEADER, 'space_feature');
    expect(response.setHeader).toHaveBeenCalledWith(X_TEABLE_V2_FEATURE_HEADER, 'deleteField');
    expect(sentryScope.setTag).toHaveBeenCalledWith(TEABLE_REQUEST_ATTRIBUTION, 'v2');
    expect(sentryScope.setTag).toHaveBeenCalledWith('teable.v2.feature', 'deleteField');
  });
});
