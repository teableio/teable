import { BadRequestException, Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalExceptionFilter } from './global-exception.filter';

const { sentryScope, captureException, withScope } = vi.hoisted(() => {
  const sentryScope = {
    setTag: vi.fn(),
    setUser: vi.fn(),
  };
  return {
    sentryScope,
    captureException: vi.fn(),
    withScope: vi.fn((callback: (scope: typeof sentryScope) => void) => callback(sentryScope)),
  };
});

vi.mock('@sentry/nestjs', () => ({
  captureException,
  withScope,
}));

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
          ['user.id', 'usr123'],
          ['user.email', 'user@example.com'],
          ['spaceId', 'spc123'],
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
      id: 'usr123',
      email: 'user@example.com',
    });
    expect(sentryScope.setTag).toHaveBeenCalledWith('space.id', 'spc123');
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
});
