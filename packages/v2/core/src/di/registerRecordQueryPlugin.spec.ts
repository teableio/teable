import type { DependencyContainer } from '@teable/v2-di';
import { describe, expect, it } from 'vitest';

import {
  createContextualLogger,
  createLogScopeContext,
  type ILogger,
  type LogContext,
} from '../ports/Logger';
import type { IRecordQueryPlugin } from '../ports/RecordQueryPlugin';
import { v2CoreTokens } from '../ports/tokens';
import { registerRecordQueryPlugin } from './registerRecordQueryPlugin';

class FakeLogger implements ILogger {
  readonly infos: Array<{ message: string; context?: LogContext }> = [];

  child(context: LogContext): ILogger {
    return createContextualLogger(this, context);
  }

  scope(scope: string, context?: LogContext): ILogger {
    return this.child(createLogScopeContext(scope, context ?? {}));
  }

  debug(): void {
    return undefined;
  }

  info(message: string, context?: LogContext): void {
    this.infos.push({ message, context });
  }

  warn(): void {
    return undefined;
  }

  error(): void {
    return undefined;
  }
}

const createPlugin = (name: string): IRecordQueryPlugin => ({
  name,
  supports: () => true,
});

const createContainer = (logger: ILogger): DependencyContainer => {
  const registrations = new Map<unknown, unknown>();
  registrations.set(v2CoreTokens.logger, logger);

  return {
    isRegistered(token: unknown) {
      return registrations.has(token);
    },
    registerInstance(token: unknown, instance: unknown) {
      registrations.set(token, instance);
      return this;
    },
    resolve<T>(token: unknown): T {
      if (!registrations.has(token)) {
        throw new Error(`Unexpected token: ${String(token)}`);
      }

      return registrations.get(token) as T;
    },
  } as unknown as DependencyContainer;
};

describe('registerRecordQueryPlugin', () => {
  it('registers each unique plugin and reports total count', () => {
    const logger = new FakeLogger();
    const container = createContainer(logger);

    const first = registerRecordQueryPlugin(container, createPlugin('alpha'), {
      source: 'test-suite',
    });
    const second = registerRecordQueryPlugin(container, createPlugin('beta'), {
      source: 'test-suite',
    });
    const duplicate = registerRecordQueryPlugin(container, createPlugin('alpha'), {
      source: 'test-suite',
    });

    expect(first).toEqual({
      plugin: expect.objectContaining({ name: 'alpha' }),
      registered: true,
      totalPlugins: 1,
    });
    expect(second).toEqual({
      plugin: expect.objectContaining({ name: 'beta' }),
      registered: true,
      totalPlugins: 2,
    });
    expect(duplicate.registered).toBe(false);
    expect(duplicate.totalPlugins).toBe(2);
    expect(logger.infos.some((entry) => entry.message === 'Record query plugin registered')).toBe(
      true
    );
  });
});
