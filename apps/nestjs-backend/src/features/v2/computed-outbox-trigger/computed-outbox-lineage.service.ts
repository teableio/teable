import { Injectable, Logger } from '@nestjs/common';

import type {
  IComputedOutboxLineageLookup,
  IComputedOutboxMaintenanceTarget,
} from '../../../global/data-db-client-manager.service';
import { DataDbClientManager } from '../../../global/data-db-client-manager.service';
import { mapWithConcurrency } from '../../../utils/map-with-concurrency';

export type ComputedOutboxLineageLookupResult = IComputedOutboxLineageLookup & {
  targetId: string;
  storage: IComputedOutboxMaintenanceTarget['storage'];
};

/**
 * Resolves computed-task lineage (T6908) by fanning the lookup out over every
 * ready storage target and returning the first target that knows the task.
 * Default storage wins ties so admin links keep pointing at the shared ledger
 * when a task transiently exists in more than one target.
 */
@Injectable()
export class ComputedOutboxLineageService {
  private readonly logger = new Logger(ComputedOutboxLineageService.name);

  constructor(private readonly dataDbClientManager: DataDbClientManager) {}

  async getTaskLineage(taskId: string): Promise<ComputedOutboxLineageLookupResult | null> {
    const targets = await this.dataDbClientManager.listComputedOutboxMaintenanceTargets();
    const results = await mapWithConcurrency(targets, 4, async (target) => {
      try {
        const lookup = await this.dataDbClientManager.lookupComputedOutboxLineage(target, taskId);
        return lookup ? { target, lookup } : null;
      } catch (error) {
        this.logger.warn(
          `computed outbox lineage lookup failed for target ${target.cacheKey}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return null;
      }
    });
    const found = results
      .filter((result): result is NonNullable<typeof result> => result !== null)
      .sort((a, b) => {
        if (a.target.storage === b.target.storage) return 0;
        return a.target.storage === 'default' ? -1 : 1;
      })[0];
    if (!found) return null;
    return {
      ...found.lookup,
      targetId: found.target.cacheKey,
      storage: found.target.storage,
    };
  }
}
