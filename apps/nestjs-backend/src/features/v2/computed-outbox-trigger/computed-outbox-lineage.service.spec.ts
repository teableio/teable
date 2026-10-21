import { describe, expect, it, vi } from 'vitest';

import type {
  IComputedOutboxLineageLookup,
  IComputedOutboxMaintenanceTarget,
} from '../../../global/data-db-client-manager.service';
import type { DataDbClientManager } from '../../../global/data-db-client-manager.service';
import { ComputedOutboxLineageService } from './computed-outbox-lineage.service';

const target = (
  cacheKey: string,
  storage: IComputedOutboxMaintenanceTarget['storage']
): IComputedOutboxMaintenanceTarget =>
  ({ cacheKey, storage }) as unknown as IComputedOutboxMaintenanceTarget;

const lookup = (taskId: string): IComputedOutboxLineageLookup =>
  ({
    task: { taskId, source: 'live' },
    chain: [{ taskId, source: 'live' }],
  }) as unknown as IComputedOutboxLineageLookup;

const createService = (params: {
  targets: IComputedOutboxMaintenanceTarget[];
  lookupByTarget: (
    candidate: IComputedOutboxMaintenanceTarget
  ) => Promise<IComputedOutboxLineageLookup | null>;
}) => {
  const manager = {
    listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(params.targets),
    lookupComputedOutboxLineage: vi.fn((candidate: IComputedOutboxMaintenanceTarget) =>
      params.lookupByTarget(candidate)
    ),
  } as unknown as DataDbClientManager;
  return new ComputedOutboxLineageService(manager);
};

describe('ComputedOutboxLineageService', () => {
  it('returns the target that knows the task', async () => {
    const service = createService({
      targets: [target('meta-fallback', 'default'), target('conn-1', 'byodb')],
      lookupByTarget: async (candidate) =>
        candidate.cacheKey === 'conn-1' ? lookup('cuo123') : null,
    });

    const result = await service.getTaskLineage('cuo123');
    expect(result).toMatchObject({ targetId: 'conn-1', storage: 'byodb' });
  });

  it('prefers default storage when several targets know the task', async () => {
    const service = createService({
      targets: [target('conn-1', 'byodb'), target('meta-fallback', 'default')],
      lookupByTarget: async () => lookup('cuo123'),
    });

    const result = await service.getTaskLineage('cuo123');
    expect(result).toMatchObject({ targetId: 'meta-fallback', storage: 'default' });
  });

  it('tolerates failing targets and returns null when the task is unknown everywhere', async () => {
    const service = createService({
      targets: [target('conn-1', 'byodb'), target('meta-fallback', 'default')],
      lookupByTarget: async (candidate) => {
        if (candidate.cacheKey === 'conn-1') throw new Error('unreachable');
        return null;
      },
    });

    await expect(service.getTaskLineage('cuo404')).resolves.toBeNull();
  });
});
