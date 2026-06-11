import type { DependencyContainer } from '@teable/v2-di';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type { ComputedUpdatePollingConfig } from './ComputedUpdatePollingService';
import { ComputedUpdatePollingService } from './ComputedUpdatePollingService';

export const startComputedUpdatePollingIfEnabled = (
  container: DependencyContainer
): ComputedUpdatePollingService | undefined => {
  if (!container.isRegistered(v2RecordRepositoryPostgresTokens.computedUpdatePollingConfig)) {
    return undefined;
  }

  const config = container.resolve<ComputedUpdatePollingConfig>(
    v2RecordRepositoryPostgresTokens.computedUpdatePollingConfig
  );
  if (!config.enabled) return undefined;

  return container.resolve<ComputedUpdatePollingService>(
    v2RecordRepositoryPostgresTokens.computedUpdatePollingService
  );
};
