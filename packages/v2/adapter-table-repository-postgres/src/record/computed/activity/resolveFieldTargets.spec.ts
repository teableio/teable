import { describe, expect, it } from 'vitest';

import type { SeedOutboxItem } from '../outbox/IComputedUpdateOutbox';
import { resolveFieldTargetsFromOutboxItem } from './resolveFieldTargets';

const seedTask = (): SeedOutboxItem => ({
  id: 'cuo123456789012345',
  taskType: 'seed',
  baseId: 'bseTestBase123456',
  seedTableId: 'tblTestTable123456',
  seedRecordIds: ['rec123'],
  extraSeedRecords: [],
  beforeImageRecords: [],
  changedFieldIds: ['fldSource123456789'],
  changeType: 'update',
  planHash: 'plan-hash',
  cyclePolicy: 'skip',
  runId: 'run-1',
  status: 'pending',
  attempts: 0,
  maxAttempts: 8,
  nextRunAt: new Date(),
  lockedAt: null,
  lockedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('resolveFieldTargetsFromOutboxItem', () => {
  it('does not expose seed input fields as computed targets', () => {
    expect(resolveFieldTargetsFromOutboxItem(seedTask())._unsafeUnwrap()).toEqual([]);
  });
});
