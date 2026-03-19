import type { DependencyContainer } from '@teable/v2-di';

import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { ILogger } from '../ports/Logger';
import type { IRecordWritePlugin } from '../ports/RecordWritePlugin';
import { v2CoreTokens } from '../ports/tokens';

export interface IRegisterRecordWritePluginOptions {
  source?: string;
  logger?: ILogger;
}

export interface IRegisterRecordWritePluginResult {
  plugin: IRecordWritePlugin;
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

const ensurePluginRegistry = (container: DependencyContainer): IRecordWritePlugin[] => {
  if (!container.isRegistered(v2CoreTokens.recordWritePlugins)) {
    container.registerInstance(v2CoreTokens.recordWritePlugins, [] as IRecordWritePlugin[]);
  }

  return container.resolve<IRecordWritePlugin[]>(v2CoreTokens.recordWritePlugins);
};

export const registerRecordWritePlugin = (
  container: DependencyContainer,
  plugin: IRecordWritePlugin,
  options: IRegisterRecordWritePluginOptions = {}
): IRegisterRecordWritePluginResult => {
  const plugins = ensurePluginRegistry(container);
  const logger = resolveLogger(container, options.logger).scope('recordWritePlugin', {
    plugin: plugin.name,
    source: options.source,
  });

  const existingPlugin = plugins.find((registeredPlugin) => registeredPlugin.name === plugin.name);
  if (existingPlugin) {
    logger.info('Record write plugin already registered', {
      totalPlugins: plugins.length,
    });

    return {
      plugin: existingPlugin,
      registered: false,
      totalPlugins: plugins.length,
    };
  }

  plugins.push(plugin);
  logger.info('Record write plugin registered', {
    totalPlugins: plugins.length,
  });

  return {
    plugin,
    registered: true,
    totalPlugins: plugins.length,
  };
};
