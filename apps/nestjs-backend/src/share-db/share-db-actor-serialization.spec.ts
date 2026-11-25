import { IdPrefix, type IOtOperation } from '@teable/core';
import { describe, expect, it } from 'vitest';

import { ShareDbAdapter } from './share-db.adapter';

describe('ShareDB physical actor serialization', () => {
  it.each([
    {
      createdByActorType: 'appUser',
      createdByActorId: 'apu_stable',
      lastModifiedByActorType: 'user',
      lastModifiedByActorId: 'usrStable',
    },
    {
      createdByActorType: null,
      createdByActorId: null,
      lastModifiedByActorType: null,
      lastModifiedByActorId: null,
    },
  ])('rebuilds all four actor properties in record gap recovery', (actors) => {
    const adapter = new ShareDbAdapter(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    // Exercise the existing recovery serializer without opening a ShareDB connection.
    const recovery = adapter as unknown as {
      getOpsFromSnapshot(docType: string, snapshot: unknown): IOtOperation[];
    };
    const ops = recovery.getOpsFromSnapshot(IdPrefix.Record, {
      id: 'recTest',
      fields: { fldTitle: 'Current row' },
      createdBy: 'usrRobot',
      ...actors,
    });
    const serialized = JSON.parse(JSON.stringify(ops));
    expect(serialized).toEqual(
      expect.arrayContaining(
        Object.entries(actors).map(([key, value]) => ({ p: [key], oi: value }))
      )
    );
    expect(serialized).toContainEqual({ p: ['fields', 'fldTitle'], oi: 'Current row' });
    expect(serialized).toHaveLength(5);
  });
});
