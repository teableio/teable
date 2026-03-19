import type { DependencyContainer } from '@teable/v2-di';

import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { IFieldOperationPlugin } from '../ports/FieldOperationPlugin';
import type { ILogger } from '../ports/Logger';
import { v2CoreTokens } from '../ports/tokens';

export interface IRegisterFieldOperationPluginOptions {
  source?: string;
  logger?: ILogger;
}

export interface IRegisterFieldOperationPluginResult {
  plugin: IFieldOperationPlugin;
  registered: boolean;
  totalPlugins: number;
}

const resolveLogger = (container: DependencyContainer, explicitLogger?: ILogger): ILogger => {
  if (explicitLogger) {
    return explicitLogger;
  }

  if (container.isRegistered(v2CoreTokens.logger)) {
    return container.resolve<ILogger>(v2CoreTokens.logger);
  }

  return new NoopLogger();
};

const ensurePluginRegistry = (container: DependencyContainer): IFieldOperationPlugin[] => {
  if (!container.isRegistered(v2CoreTokens.fieldOperationPlugins)) {
    container.registerInstance(v2CoreTokens.fieldOperationPlugins, [] as IFieldOperationPlugin[]);
  }

  return container.resolve<IFieldOperationPlugin[]>(v2CoreTokens.fieldOperationPlugins);
};

export const registerFieldOperationPlugin = (
  container: DependencyContainer,
  plugin: IFieldOperationPlugin,
  options: IRegisterFieldOperationPluginOptions = {}
): IRegisterFieldOperationPluginResult => {
  const plugins = ensurePluginRegistry(container);
  const logger = resolveLogger(container, options.logger).scope('fieldOperationPlugin', {
    plugin: plugin.name,
    source: options.source,
  });

  const existingPlugin = plugins.find((registeredPlugin) => registeredPlugin.name === plugin.name);
  if (existingPlugin) {
    logger.info('Field operation plugin already registered', {
      totalPlugins: plugins.length,
    });

    return {
      plugin: existingPlugin,
      registered: false,
      totalPlugins: plugins.length,
    };
  }

  plugins.push(plugin);
  logger.info('Field operation plugin registered', {
    totalPlugins: plugins.length,
  });

  return {
    plugin,
    registered: true,
    totalPlugins: plugins.length,
  };
};
