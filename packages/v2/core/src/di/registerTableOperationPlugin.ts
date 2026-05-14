import type { DependencyContainer } from '@teable/v2-di';

import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { ILogger } from '../ports/Logger';
import type { ITableOperationPlugin } from '../ports/TableOperationPlugin';
import { v2CoreTokens } from '../ports/tokens';

export interface IRegisterTableOperationPluginOptions {
  source?: string;
  logger?: ILogger;
}

export interface IRegisterTableOperationPluginResult {
  plugin: ITableOperationPlugin;
  registered: boolean;
  totalPlugins: number;
}

const resolveLogger = (container: DependencyContainer, explicitLogger?: ILogger): ILogger => {
  if (explicitLogger) return explicitLogger;
  if (container.isRegistered(v2CoreTokens.logger)) {
    return container.resolve<ILogger>(v2CoreTokens.logger);
  }
  return new NoopLogger();
};

const ensurePluginRegistry = (container: DependencyContainer): ITableOperationPlugin[] => {
  if (!container.isRegistered(v2CoreTokens.tableOperationPlugins)) {
    container.registerInstance(v2CoreTokens.tableOperationPlugins, [] as ITableOperationPlugin[]);
  }

  return container.resolve<ITableOperationPlugin[]>(v2CoreTokens.tableOperationPlugins);
};

export const registerTableOperationPlugin = (
  container: DependencyContainer,
  plugin: ITableOperationPlugin,
  options: IRegisterTableOperationPluginOptions = {}
): IRegisterTableOperationPluginResult => {
  const plugins = ensurePluginRegistry(container);
  const logger = resolveLogger(container, options.logger).scope('tableOperationPlugin', {
    plugin: plugin.name,
    source: options.source,
  });

  const existingPlugin = plugins.find((registeredPlugin) => registeredPlugin.name === plugin.name);
  if (existingPlugin) {
    logger.info('Table operation plugin already registered', {
      totalPlugins: plugins.length,
    });
    return {
      plugin: existingPlugin,
      registered: false,
      totalPlugins: plugins.length,
    };
  }

  plugins.push(plugin);
  logger.info('Table operation plugin registered', {
    totalPlugins: plugins.length,
  });

  return {
    plugin,
    registered: true,
    totalPlugins: plugins.length,
  };
};
