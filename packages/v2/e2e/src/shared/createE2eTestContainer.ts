import {
  createV2NodeTestContainer,
  type IV2NodeTestContainerOptions,
} from '@teable/v2-container-node-test';

export type E2eDbMode = 'pglite' | 'postgres';

export interface IE2eTestContainerOptions extends IV2NodeTestContainerOptions {
  dbMode?: E2eDbMode;
}

const DEFAULT_E2E_DB_MODE: E2eDbMode = 'pglite';

export const createE2eTestContainer = async (options: IE2eTestContainerOptions = {}) => {
  const { dbMode = DEFAULT_E2E_DB_MODE, connectionString, ...containerOptions } = options;

  const resolvedConnectionString =
    connectionString ?? (dbMode === 'pglite' ? 'memory://' : undefined);

  return createV2NodeTestContainer({
    ...containerOptions,
    ...(resolvedConnectionString ? { connectionString: resolvedConnectionString } : {}),
  });
};
