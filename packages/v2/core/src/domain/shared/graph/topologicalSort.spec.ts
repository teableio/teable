import { describe, expect, it } from 'vitest';

import { FieldId } from '../../table/fields/FieldId';
import { topologicalSort } from './topologicalSort';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

describe('topologicalSort', () => {
  it('orders nodes by dependencies with stable output', () => {
    const a = createFieldId('a');
    const b = createFieldId('b');
    const c = createFieldId('c');
    const aId = a._unsafeUnwrap();
    const bId = b._unsafeUnwrap();
    const cId = c._unsafeUnwrap();

    const result = topologicalSort([
      { id: aId, dependencies: [] },
      { id: bId, dependencies: [] },
      { id: cId, dependencies: [aId, bId] },
    ]);

    expect(result.order.map((id) => id.toString())).toEqual([
      aId.toString(),
      bId.toString(),
      cId.toString(),
    ]);
    expect(result.cycles).toEqual([]);
  });

  it('detects simple cycles', () => {
    const a = createFieldId('d');
    const b = createFieldId('e');
    const aId = a._unsafeUnwrap();
    const bId = b._unsafeUnwrap();

    const result = topologicalSort([
      { id: aId, dependencies: [bId] },
      { id: bId, dependencies: [aId] },
    ]);

    expect(result.cycles.length).toBeGreaterThan(0);
    const cycleIds = result.cycles.flat().map((id) => id.toString());
    expect(cycleIds).toContain(aId.toString());
    expect(cycleIds).toContain(bId.toString());
  });

  it('detects self cycles', () => {
    const a = createFieldId('f');
    const aId = a._unsafeUnwrap();

    const result = topologicalSort([{ id: aId, dependencies: [aId] }]);
    expect(result.cycles.length).toBeGreaterThan(0);
    const cycleIds = result.cycles.flat().map((id) => id.toString());
    expect(cycleIds).toContain(aId.toString());
  });
});
