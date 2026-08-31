import type { DependencyContainer } from '@teable/v2-di';

import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { ILogger } from '../ports/Logger';
import type { IRecordQueryPlugin } from '../ports/RecordQueryPlugin';
import { v2CoreTokens } from '../ports/tokens';

export interface IRegisterRecordQueryPluginOptions {
  source?: string;
  logger?: ILogger;
}

export interface IRegisterRecordQueryPluginResult {
  plugin: IRecordQueryPlugin;
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

const ensurePluginRegistry = (container: DependencyContainer): IRecordQueryPlugin[] => {
  if (!container.isRegistered(v2CoreTokens.recordQueryPlugins)) {
    container.registerInstance(v2CoreTokens.recordQueryPlugins, [] as IRecordQueryPlugin[]);
  }

  return container.resolve<IRecordQueryPlugin[]>(v2CoreTokens.recordQueryPlugins);
};

export const registerRecordQueryPlugin = (
  container: DependencyContainer,
  plugin: IRecordQueryPlugin,
  options: IRegisterRecordQueryPluginOptions = {}
): IRegisterRecordQueryPluginResult => {
  const plugins = ensurePluginRegistry(container);
  const logger = resolveLogger(container, options.logger).scope('recordQueryPlugin', {
    plugin: plugin.name,
    source: options.source,
  });

  const existingPlugin = plugins.find((registeredPlugin) => registeredPlugin.name === plugin.name);
  if (existingPlugin) {
    logger.info('Record query plugin already registered', {
      totalPlugins: plugins.length,
    });

    return {
      plugin: existingPlugin,
      registered: false,
      totalPlugins: plugins.length,
    };
  }

  plugins.push(plugin);
  logger.info('Record query plugin registered', {
    totalPlugins: plugins.length,
  });

  return {
    plugin,
    registered: true,
    totalPlugins: plugins.length,
  };
};
