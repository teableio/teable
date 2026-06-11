import { BadRequestException, Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalExceptionFilter } from './global-exception.filter';

const { activeSpan, runtimeErrorCounter, sentryScope, captureException, withScope } = vi.hoisted(
  () => {
    const activeSpan = {
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
    };
    const runtimeErrorCounter = {
      add: vi.fn(),
    };
    const sentryScope = {
      setContext: vi.fn(),
      setTag: vi.fn(),
      setUser: vi.fn(),
    };
    return {
      activeSpan,
      runtimeErrorCounter,
      sentryScope,
      captureException: vi.fn(),
      withScope: vi.fn((callback: (scope: typeof sentryScope) => void) => callback(sentryScope)),
    };
  }
);

vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: vi.fn(() => ({
      createCounter: vi.fn(() => runtimeErrorCounter),
    })),
  },
  SpanStatusCode: {
    ERROR: 2,
  },
  trace: {
    getActiveSpan: vi.fn(() => activeSpan),
  },
}));

vi.mock('@sentry/nestjs', () => ({
  captureException,
  withScope,
}));

const userId = 'usr123';
const userEmail = 'user@example.com';
const spaceId = 'spc123';
const dataDbConnectionId = 'dcn123';
const dataDbUrlFingerprint = 'fp123';
const dataDbErrorCode = 'data_db.database_missing';
const dataDbOtelAttribute = {
  errorCode: 'teable.data_db.error_code',
  connectionId: 'teable.data_db.connection_id',
  urlFingerprint: 'teable.data_db.url_fingerprint',
  retryable: 'teable.data_db.retryable',
  userActionable: 'teable.data_db.user_actionable',
} as const;

describe('GlobalExceptionFilter', () => {
  const configService = {
    getOrThrow: vi.fn(() => ({ enableGlobalErrorLogging: false })),
  };

  const response: {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  } = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);

  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ url: '/api/test' }),
      getResponse: () => response,
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('captures unexpected exceptions with CLS user and space context', () => {
    const cls = {
      get: vi.fn((key: string) => {
        const values = new Map<string, unknown>([
          ['user.id', userId],
          ['user.email', userEmail],
          ['spaceId', spaceId],
        ]);
        return values.get(key);
      }),
    };
    const exception = new Error('boom');
    const filter = new GlobalExceptionFilter(configService as never, cls as never);

    filter.catch(exception, host as never);

    expect(withScope).toHaveBeenCalledTimes(1);
    expect(sentryScope.setUser).toHaveBeenNthCalledWith(1, null);
    expect(sentryScope.setUser).toHaveBeenNthCalledWith(2, {
      id: userId,
      email: userEmail,
    });
    expect(sentryScope.setTag).toHaveBeenCalledWith('space.id', spaceId);
    expect(captureException).toHaveBeenCalledWith(exception, {
      mechanism: { handled: false, type: 'auto.function.nestjs.exception_captured' },
    });
  });

  it('does not capture expected Nest HTTP exceptions', () => {
    const filter = new GlobalExceptionFilter(configService as never);

    filter.catch(new BadRequestException('bad input'), host as never);

    expect(withScope).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('returns a classified BYODB runtime error and annotates Sentry plus OTel', () => {
    const cls = {
      get: vi.fn((key: string) => {
        const values = new Map<string, unknown>([
          ['user.id', userId],
          ['user.email', userEmail],
          ['spaceId', spaceId],
          [
            'dataDb',
            {
              mode: 'byodb',
              spaceId,
              connectionId: dataDbConnectionId,
              urlFingerprint: dataDbUrlFingerprint,
              displayHost: 'db.example.com',
              displayDatabase: 'customer_data',
              internalSchema: 'teable_internal',
            },
          ],
        ]);
        return values.get(key);
      }),
    };
    const exception = Object.assign(new Error('database "secret_customer_db" does not exist'), {
      code: '3D000',
    });
    const filter = new GlobalExceptionFilter(configService as never, cls as never);

    filter.catch(exception, host as never);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({
      message:
        'The data database bound to this space is currently unavailable. Please check the external database connection and try again.',
      status: 503,
      code: 'database_connection_unavailable',
      data: {
        dataDb: {
          code: dataDbErrorCode,
          retryable: false,
          userActionable: true,
          connectionId: dataDbConnectionId,
          urlFingerprint: dataDbUrlFingerprint,
          displayHost: 'db.example.com',
          displayDatabase: 'customer_data',
          internalSchema: 'teable_internal',
        },
      },
    });
    expect(JSON.stringify(response.json.mock.calls.at(-1)?.[0])).not.toContain(
      'secret_customer_db'
    );
    expect(sentryScope.setTag).toHaveBeenCalledWith('data_db.error_code', dataDbErrorCode);
    expect(sentryScope.setTag).toHaveBeenCalledWith('data_db.connection_id', dataDbConnectionId);
    expect(sentryScope.setContext).toHaveBeenCalledWith(
      'data_db',
      expect.objectContaining({
        errorCode: dataDbErrorCode,
        driverCode: '3D000',
        connectionId: dataDbConnectionId,
        urlFingerprint: dataDbUrlFingerprint,
      })
    );
    expect(activeSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        [dataDbOtelAttribute.errorCode]: dataDbErrorCode,
        [dataDbOtelAttribute.connectionId]: dataDbConnectionId,
        [dataDbOtelAttribute.urlFingerprint]: dataDbUrlFingerprint,
      })
    );
    expect(activeSpan.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: dataDbErrorCode,
    });
    expect(runtimeErrorCounter.add).toHaveBeenCalledWith(1, {
      [dataDbOtelAttribute.errorCode]: dataDbErrorCode,
      [dataDbOtelAttribute.retryable]: false,
      [dataDbOtelAttribute.userActionable]: true,
    });
  });
});
