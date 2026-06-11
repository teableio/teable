import type { DependencyContainer } from '@teable/v2-di';

import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { ILogger } from '../ports/Logger';
import type { ITableDataSafetyLimitPlugin } from '../ports/TableDataSafetyLimitPlugin';
import { v2CoreTokens } from '../ports/tokens';

export interface IRegisterTableDataSafetyLimitPluginOptions {
  source?: string;
  logger?: ILogger;
}

export interface IRegisterTableDataSafetyLimitPluginResult {
  plugin: ITableDataSafetyLimitPlugin;
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

const ensurePluginRegistry = (container: DependencyContainer): ITableDataSafetyLimitPlugin[] => {
  if (!container.isRegistered(v2CoreTokens.tableDataSafetyLimitPlugins)) {
    container.registerInstance(
      v2CoreTokens.tableDataSafetyLimitPlugins,
      [] as ITableDataSafetyLimitPlugin[]
    );
  }

  return container.resolve<ITableDataSafetyLimitPlugin[]>(v2CoreTokens.tableDataSafetyLimitPlugins);
};

export const registerTableDataSafetyLimitPlugin = (
  container: DependencyContainer,
  plugin: ITableDataSafetyLimitPlugin,
  options: IRegisterTableDataSafetyLimitPluginOptions = {}
): IRegisterTableDataSafetyLimitPluginResult => {
  const plugins = ensurePluginRegistry(container);
  const logger = resolveLogger(container, options.logger).scope('tableDataSafetyLimitPlugin', {
    plugin: plugin.name,
    source: options.source,
  });

  const existingPlugin = plugins.find((registeredPlugin) => registeredPlugin.name === plugin.name);
  if (existingPlugin) {
    logger.info('Table data safety limit plugin already registered', {
      totalPlugins: plugins.length,
    });
    return {
      plugin: existingPlugin,
      registered: false,
      totalPlugins: plugins.length,
    };
  }

  plugins.push(plugin);
  logger.info('Table data safety limit plugin registered', {
    totalPlugins: plugins.length,
  });

  return {
    plugin,
    registered: true,
    totalPlugins: plugins.length,
  };
};
