import { Role, type IRole } from '@teable/core';
import { describe, expect, it } from 'vitest';
import { mergeBaseVisitRows } from './merge-base-visit-rows';

const visit = (params: {
  resourceId: string;
  lastVisitTime: string;
  resourceRole: IRole;
  spaceId?: string;
}) => ({
  resourceId: params.resourceId,
  lastVisitTime: params.lastVisitTime,
  resourceRole: params.resourceRole,
  spaceId: params.spaceId ?? 'spc1',
});

describe('mergeBaseVisitRows', () => {
  it('keeps the newest visit when timestamps differ', () => {
    const merged = mergeBaseVisitRows([
      visit({
        resourceId: 'bseA',
        lastVisitTime: '2026-09-02T00:00:00.000Z',
        resourceRole: Role.Owner,
      }),
      visit({
        resourceId: 'bseB',
        lastVisitTime: '2026-09-02T00:00:02.000Z',
        resourceRole: Role.Viewer,
      }),
    ]);

    expect(merged.map((row) => row.resourceId)).toEqual(['bseB', 'bseA']);
  });

  it('resolves the highest collaborator role when overlapping rows share a visit time', () => {
    const merged = mergeBaseVisitRows([
      visit({
        resourceId: 'bseA',
        lastVisitTime: '2026-09-02T00:00:01.000Z',
        resourceRole: Role.Viewer,
        spaceId: 'spc-space-collab',
      }),
      visit({
        resourceId: 'bseA',
        lastVisitTime: '2026-09-02T00:00:01.000Z',
        resourceRole: Role.Owner,
        spaceId: 'spc-base-collab',
      }),
      visit({
        resourceId: 'bseA',
        lastVisitTime: '2026-09-02T00:00:01.000Z',
        resourceRole: Role.Editor,
        spaceId: 'spc-dept-collab',
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.resourceRole).toBe(Role.Owner);
  });

  it('keeps the later visit fields while still taking the higher overlapping role', () => {
    const merged = mergeBaseVisitRows([
      visit({
        resourceId: 'bseA',
        lastVisitTime: '2026-09-02T00:00:01.000Z',
        resourceRole: Role.Owner,
        spaceId: 'spc-old',
      }),
      visit({
        resourceId: 'bseA',
        lastVisitTime: '2026-09-02T00:00:02.000Z',
        resourceRole: Role.Viewer,
        spaceId: 'spc-new',
      }),
    ]);

    expect(merged).toEqual([
      visit({
        resourceId: 'bseA',
        lastVisitTime: '2026-09-02T00:00:02.000Z',
        resourceRole: Role.Owner,
        spaceId: 'spc-new',
      }),
    ]);
  });
});
