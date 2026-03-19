import type { DependencyContainer } from '@teable/v2-di';
import { describe, expect, it } from 'vitest';

import {
  createContextualLogger,
  createLogScopeContext,
  type ILogger,
  type LogContext,
} from '../ports/Logger';
import type { IRecordWritePlugin } from '../ports/RecordWritePlugin';
import { v2CoreTokens } from '../ports/tokens';
import { registerRecordWritePlugin } from './registerRecordWritePlugin';

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

const createPlugin = (name: string): IRecordWritePlugin => ({
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

describe('registerRecordWritePlugin', () => {
  it('logs each plugin registration with the total plugin count', () => {
    const logger = new FakeLogger();
    const container = createContainer(logger);

    const first = registerRecordWritePlugin(container, createPlugin('alpha'), {
      source: 'test-suite',
    });
    const second = registerRecordWritePlugin(container, createPlugin('beta'), {
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
    expect(logger.infos).toHaveLength(2);
    expect(logger.infos[0]).toEqual({
      message: 'Record write plugin registered',
      context: {
        scopes: {
          recordWritePlugin: {
            plugin: 'alpha',
            source: 'test-suite',
          },
        },
        totalPlugins: 1,
      },
    });
    expect(logger.infos[1]).toEqual({
      message: 'Record write plugin registered',
      context: {
        scopes: {
          recordWritePlugin: {
            plugin: 'beta',
            source: 'test-suite',
          },
        },
        totalPlugins: 2,
      },
    });
  });

  it('logs duplicate registration attempts without changing the total count', () => {
    const logger = new FakeLogger();
    const container = createContainer(logger);
    const plugin = createPlugin('duplicate');

    registerRecordWritePlugin(container, plugin, {
      source: 'test-suite',
    });
    const duplicate = registerRecordWritePlugin(container, createPlugin('duplicate'), {
      source: 'test-suite',
    });

    expect(duplicate).toEqual({
      plugin,
      registered: false,
      totalPlugins: 1,
    });
    expect(logger.infos).toHaveLength(2);
    expect(logger.infos[1]).toEqual({
      message: 'Record write plugin already registered',
      context: {
        scopes: {
          recordWritePlugin: {
            plugin: 'duplicate',
            source: 'test-suite',
          },
        },
        totalPlugins: 1,
      },
    });
  });
});
