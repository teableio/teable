import type { DependencyContainer } from '@teable/v2-di';

import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { ILogger } from '../ports/Logger';
import { v2CoreTokens } from '../ports/tokens';
import type { IViewOperationPlugin } from '../ports/ViewOperationPlugin';

export interface IRegisterViewOperationPluginOptions {
  source?: string;
  logger?: ILogger;
}

export interface IRegisterViewOperationPluginResult {
  plugin: IViewOperationPlugin;
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

const ensurePluginRegistry = (container: DependencyContainer): IViewOperationPlugin[] => {
  if (!container.isRegistered(v2CoreTokens.viewOperationPlugins)) {
    container.registerInstance(v2CoreTokens.viewOperationPlugins, [] as IViewOperationPlugin[]);
  }

  return container.resolve<IViewOperationPlugin[]>(v2CoreTokens.viewOperationPlugins);
};

export const registerViewOperationPlugin = (
  container: DependencyContainer,
  plugin: IViewOperationPlugin,
  options: IRegisterViewOperationPluginOptions = {}
): IRegisterViewOperationPluginResult => {
  const plugins = ensurePluginRegistry(container);
  const logger = resolveLogger(container, options.logger).scope('viewOperationPlugin', {
    plugin: plugin.name,
    source: options.source,
  });

  const existingPlugin = plugins.find((registeredPlugin) => registeredPlugin.name === plugin.name);
  if (existingPlugin) {
    logger.info('View operation plugin already registered', {
      totalPlugins: plugins.length,
    });
    return {
      plugin: existingPlugin,
      registered: false,
      totalPlugins: plugins.length,
    };
  }

  plugins.push(plugin);
  logger.info('View operation plugin registered', {
    totalPlugins: plugins.length,
  });

  return {
    plugin,
    registered: true,
    totalPlugins: plugins.length,
  };
};
