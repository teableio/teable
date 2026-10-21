import { describe, expect, it } from 'vitest';

import { groupComputedOutboxAnomalies } from './groupAnomalies';

const anomalyFields = {
  failedSql: null,
  failureKind: null,
  failurePhase: null,
  affectedTableName: null,
} as const;

describe('groupComputedOutboxAnomalies', () => {
  it('merges repeated root causes into groups and keeps recent samples', () => {
    const result = groupComputedOutboxAnomalies(
      [
        {
          targetId: 'meta-fallback',
          storage: 'default',
          kind: 'dead',
          taskId: 'cuo-2',
          baseId: 'bse1',
          seedTableId: 'tbl1',
          attempts: 8,
          maxAttempts: 8,
          lastError: 'statement timeout',
          failedSql: 'update t set x = 1',
          failureKind: 'statement_timeout',
          failurePhase: 'execute_plan',
          affectedTableName: 't',
          occurredAt: new Date('2026-07-15T05:00:00.000Z'),
        },
        {
          targetId: 'meta-fallback',
          storage: 'default',
          kind: 'dead',
          taskId: 'cuo-1',
          baseId: 'bse1',
          seedTableId: 'tbl1',
          attempts: 8,
          maxAttempts: 8,
          lastError: 'statement timeout',
          failedSql: null,
          failureKind: 'statement_timeout',
          failurePhase: 'execute_plan',
          affectedTableName: 't',
          occurredAt: new Date('2026-07-15T04:00:00.000Z'),
        },
        {
          targetId: 'dcn1',
          storage: 'byodb',
          kind: 'stale',
          taskId: 'cuo-3',
          baseId: 'bse2',
          seedTableId: 'tbl2',
          attempts: 1,
          maxAttempts: 8,
          lastError: null,
          ...anomalyFields,
          occurredAt: new Date('2026-07-15T06:00:00.000Z'),
        },
      ],
      { groupLimit: 10, sampleLimit: 12 }
    );

    expect(result.groupTotal).toBe(2);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]).toMatchObject({
      kind: 'stale',
      count: 1,
      baseId: 'bse2',
    });
    expect(result.groups[1]).toMatchObject({
      kind: 'dead',
      count: 2,
      baseId: 'bse1',
      failedSql: 'update t set x = 1',
      items: [{ taskId: 'cuo-2' }, { taskId: 'cuo-1' }],
    });
  });

  it('merges errors that differ only by volatile numeric identifiers', () => {
    const common = {
      targetId: 'meta-fallback',
      storage: 'default' as const,
      kind: 'dead' as const,
      baseId: 'bse1',
      seedTableId: 'tbl1',
      attempts: 3,
      maxAttempts: 3,
      ...anomalyFields,
      failureKind: 'transient',
      failurePhase: 'execute_plan',
    };
    const result = groupComputedOutboxAnomalies([
      {
        ...common,
        taskId: 'cuo-1',
        lastError:
          'Failed to create dirty table: error: could not create file "base/16385/t50_1262301": No space left on device',
        occurredAt: new Date('2026-07-15T05:00:00.000Z'),
      },
      {
        ...common,
        taskId: 'cuo-2',
        lastError:
          'Failed to create dirty table: error: could not create file "base/16385/t91_1262300": No space left on device',
        occurredAt: new Date('2026-07-15T04:00:00.000Z'),
      },
    ]);

    expect(result.groupTotal).toBe(1);
    expect(result.groups[0]).toMatchObject({
      count: 2,
      errorSignature:
        'Failed to create dirty table: error: could not create file "base/#/t#_#": No space left on device',
      lastError:
        'Failed to create dirty table: error: could not create file "base/16385/t50_1262301": No space left on device',
    });
  });

  it('keeps identical root-cause signatures isolated by storage target', () => {
    const common = {
      kind: 'dead' as const,
      baseId: 'bse1',
      seedTableId: 'tbl1',
      attempts: 8,
      maxAttempts: 8,
      lastError: 'statement timeout',
      ...anomalyFields,
    };
    const result = groupComputedOutboxAnomalies([
      {
        ...common,
        targetId: 'meta-fallback',
        storage: 'default',
        taskId: 'cuo-default',
        occurredAt: new Date('2026-07-15T05:00:00.000Z'),
      },
      {
        ...common,
        targetId: 'dcn1',
        storage: 'byodb',
        taskId: 'cuo-byodb',
        occurredAt: new Date('2026-07-15T04:00:00.000Z'),
      },
    ]);

    expect(result.groupTotal).toBe(2);
    expect(result.groups.map((group) => group.targetId)).toEqual(['meta-fallback', 'dcn1']);
  });

  it('applies the group filter before the limit slice so older matches stay reachable', () => {
    const common = {
      kind: 'dead' as const,
      seedTableId: 'tbl1',
      attempts: 8,
      maxAttempts: 8,
      lastError: 'statement timeout',
      targetId: 'meta-fallback',
      storage: 'default' as const,
      ...anomalyFields,
    };
    const result = groupComputedOutboxAnomalies(
      [
        {
          ...common,
          baseId: 'bse-recent',
          taskId: 'cuo-recent',
          occurredAt: new Date('2026-07-15T06:00:00.000Z'),
        },
        {
          ...common,
          baseId: 'bse-old',
          taskId: 'cuo-old',
          occurredAt: new Date('2026-07-15T04:00:00.000Z'),
        },
      ],
      { groupLimit: 1, filter: (group) => group.baseId === 'bse-old' }
    );

    expect(result.groupTotal).toBe(2);
    expect(result.matchedGroupTotal).toBe(1);
    expect(result.groups.map((group) => group.baseId)).toEqual(['bse-old']);
  });
});
