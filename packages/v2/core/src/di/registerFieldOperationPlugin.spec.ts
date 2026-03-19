import type { DependencyContainer } from '@teable/v2-di';
import { describe, expect, it } from 'vitest';

import type { IFieldOperationPlugin } from '../ports/FieldOperationPlugin';
import {
  createContextualLogger,
  createLogScopeContext,
  type ILogger,
  type LogContext,
} from '../ports/Logger';
import { v2CoreTokens } from '../ports/tokens';
import { registerFieldOperationPlugin } from './registerFieldOperationPlugin';

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

const createPlugin = (name: string): IFieldOperationPlugin => ({
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

describe('registerFieldOperationPlugin', () => {
  it('logs each plugin registration with the total plugin count', () => {
    const logger = new FakeLogger();
    const container = createContainer(logger);

    const first = registerFieldOperationPlugin(container, createPlugin('alpha'), {
      source: 'test-suite',
    });
    const second = registerFieldOperationPlugin(container, createPlugin('beta'), {
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
      message: 'Field operation plugin registered',
      context: {
        scopes: {
          fieldOperationPlugin: {
            plugin: 'alpha',
            source: 'test-suite',
          },
        },
        totalPlugins: 1,
      },
    });
    expect(logger.infos[1]).toEqual({
      message: 'Field operation plugin registered',
      context: {
        scopes: {
          fieldOperationPlugin: {
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

    registerFieldOperationPlugin(container, plugin, {
      source: 'test-suite',
    });
    const duplicate = registerFieldOperationPlugin(container, createPlugin('duplicate'), {
      source: 'test-suite',
    });

    expect(duplicate).toEqual({
      plugin,
      registered: false,
      totalPlugins: 1,
    });
    expect(logger.infos).toHaveLength(2);
    expect(logger.infos[1]).toEqual({
      message: 'Field operation plugin already registered',
      context: {
        scopes: {
          fieldOperationPlugin: {
            plugin: 'duplicate',
            source: 'test-suite',
          },
        },
        totalPlugins: 1,
      },
    });
  });
});
