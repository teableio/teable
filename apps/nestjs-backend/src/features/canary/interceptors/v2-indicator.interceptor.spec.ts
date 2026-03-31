import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
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
  it('records request attribution separately from v2 route tags', () => {
    const setAttributes = vi.fn();
    getActiveSpan.mockReturnValue({ setAttributes });
    sentryScope.setTag.mockReset();

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
});
