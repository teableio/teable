import { describe, expect, it } from 'vitest';

import { FieldId } from '../../table/fields/FieldId';
import { topologicalSort } from './topologicalSort';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

describe('topologicalSort', () => {
  it('orders nodes by dependencies with stable output', () => {
    const a = createFieldId('a');
    const b = createFieldId('b');
    const c = createFieldId('c');
    expect([a, b, c].every((r) => r.isOk())).toBe(true);
    if (a.isErr() || b.isErr() || c.isErr()) return;

    const result = topologicalSort([
      { id: a.value, dependencies: [] },
      { id: b.value, dependencies: [] },
      { id: c.value, dependencies: [a.value, b.value] },
    ]);

    expect(result.order.map((id) => id.toString())).toEqual([
      a.value.toString(),
      b.value.toString(),
      c.value.toString(),
    ]);
    expect(result.cycles).toEqual([]);
  });

  it('detects simple cycles', () => {
    const a = createFieldId('d');
    const b = createFieldId('e');
    expect([a, b].every((r) => r.isOk())).toBe(true);
    if (a.isErr() || b.isErr()) return;

    const result = topologicalSort([
      { id: a.value, dependencies: [b.value] },
      { id: b.value, dependencies: [a.value] },
    ]);

    expect(result.cycles.length).toBeGreaterThan(0);
    const cycleIds = result.cycles.flat().map((id) => id.toString());
    expect(cycleIds).toContain(a.value.toString());
    expect(cycleIds).toContain(b.value.toString());
  });

  it('detects self cycles', () => {
    const a = createFieldId('f');
    expect(a.isOk()).toBe(true);
    if (a.isErr()) return;

    const result = topologicalSort([{ id: a.value, dependencies: [a.value] }]);
    expect(result.cycles.length).toBeGreaterThan(0);
    const cycleIds = result.cycles.flat().map((id) => id.toString());
    expect(cycleIds).toContain(a.value.toString());
  });
});
