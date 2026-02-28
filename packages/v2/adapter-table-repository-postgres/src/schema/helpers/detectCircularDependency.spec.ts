import { FieldId, TableId } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import type { FieldDependencyEdge } from '../../record/computed/FieldDependencyGraph';
import { detectCircularDependency } from './detectCircularDependency';

describe('detectCircularDependency', () => {
  // Create valid field/table IDs with proper format
  const createFieldId = (suffix: string) => {
    const id = `fld${suffix.padStart(16, '0')}`;
    return FieldId.create(id)._unsafeUnwrap();
  };
  const createTableId = (suffix: string) => {
    const id = `tbl${suffix.padStart(16, '0')}`;
    return TableId.create(id)._unsafeUnwrap();
  };

  it('should return ok for empty edges', () => {
    const result = detectCircularDependency([]);
    expect(result.isOk()).toBe(true);
  });

  it('should return ok for a simple linear dependency chain', () => {
    const edges: FieldDependencyEdge[] = [
      {
        fromFieldId: createFieldId('1'),
        toFieldId: createFieldId('2'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
      {
        fromFieldId: createFieldId('2'),
        toFieldId: createFieldId('3'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
    ];

    const result = detectCircularDependency(edges);
    expect(result.isOk()).toBe(true);
  });

  it('should detect a simple two-node cycle', () => {
    const edges: FieldDependencyEdge[] = [
      {
        fromFieldId: createFieldId('1'),
        toFieldId: createFieldId('2'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
      {
        fromFieldId: createFieldId('2'),
        toFieldId: createFieldId('1'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
    ];

    const result = detectCircularDependency(edges);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toMatch(/circular dependency/i);
    }
  });

  it('should detect a three-node cycle', () => {
    const edges: FieldDependencyEdge[] = [
      {
        fromFieldId: createFieldId('1'),
        toFieldId: createFieldId('2'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
      {
        fromFieldId: createFieldId('2'),
        toFieldId: createFieldId('3'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
      {
        fromFieldId: createFieldId('3'),
        toFieldId: createFieldId('1'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
    ];

    const result = detectCircularDependency(edges);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toMatch(/circular dependency/i);
    }
  });

  it('should detect cross-table circular dependencies', () => {
    // Beta.betaRollup → Alpha.alphaRollup → Beta.betaRollup
    const edges: FieldDependencyEdge[] = [
      {
        fromFieldId: createFieldId('10'),
        toFieldId: createFieldId('20'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('2'),
        kind: 'cross_record',
        semantic: 'conditional_rollup_source',
      },
      {
        fromFieldId: createFieldId('20'),
        toFieldId: createFieldId('30'),
        fromTableId: createTableId('2'),
        toTableId: createTableId('1'),
        kind: 'cross_record',
        semantic: 'conditional_rollup_source',
      },
      {
        fromFieldId: createFieldId('30'),
        toFieldId: createFieldId('20'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('2'),
        kind: 'cross_record',
        semantic: 'conditional_rollup_source',
      },
    ];

    const result = detectCircularDependency(edges);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toMatch(/circular dependency/i);
    }
  });

  it('should handle duplicate edges without false positives', () => {
    // This is the critical test case that was failing:
    // Same edge appears twice with different semantics (link_title and formula_ref)
    const edges: FieldDependencyEdge[] = [
      {
        fromFieldId: createFieldId('100'),
        toFieldId: createFieldId('200'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('2'),
        kind: 'cross_record',
        semantic: 'link_title',
      },
      {
        fromFieldId: createFieldId('100'),
        toFieldId: createFieldId('200'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('2'),
        kind: 'cross_record',
        semantic: 'formula_ref',
      },
    ];

    const result = detectCircularDependency(edges);
    expect(result.isOk()).toBe(true);
  });

  it('should not report false positives for complex graphs with duplicate edges', () => {
    // Multiple fields with duplicated edges
    const edges: FieldDependencyEdge[] = [
      // Field A depends on B (duplicated)
      {
        fromFieldId: createFieldId('100'),
        toFieldId: createFieldId('101'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
      {
        fromFieldId: createFieldId('100'),
        toFieldId: createFieldId('101'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'lookup_link',
      },
      // Field C depends on B
      {
        fromFieldId: createFieldId('100'),
        toFieldId: createFieldId('102'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
    ];

    const result = detectCircularDependency(edges);
    expect(result.isOk()).toBe(true);
  });

  it('should handle self-referencing edges', () => {
    // A field that references itself (should be detected as a cycle)
    const edges: FieldDependencyEdge[] = [
      {
        fromFieldId: createFieldId('1'),
        toFieldId: createFieldId('1'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
    ];

    const result = detectCircularDependency(edges);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toMatch(/circular dependency/i);
    }
  });

  it('should handle diamond-shaped dependency graphs', () => {
    // D depends on B and C, both depend on A - no cycle
    const edges: FieldDependencyEdge[] = [
      {
        fromFieldId: createFieldId('1'),
        toFieldId: createFieldId('2'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
      {
        fromFieldId: createFieldId('1'),
        toFieldId: createFieldId('3'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
      {
        fromFieldId: createFieldId('2'),
        toFieldId: createFieldId('4'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
      {
        fromFieldId: createFieldId('3'),
        toFieldId: createFieldId('4'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
    ];

    const result = detectCircularDependency(edges);
    expect(result.isOk()).toBe(true);
  });

  it('should detect cycle in a complex graph with non-cycle branches', () => {
    const edges: FieldDependencyEdge[] = [
      // Linear chain: A → B → C
      {
        fromFieldId: createFieldId('1'),
        toFieldId: createFieldId('2'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
      {
        fromFieldId: createFieldId('2'),
        toFieldId: createFieldId('3'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
      // Cycle: D → E → F → D
      {
        fromFieldId: createFieldId('10'),
        toFieldId: createFieldId('11'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
      {
        fromFieldId: createFieldId('11'),
        toFieldId: createFieldId('12'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
      {
        fromFieldId: createFieldId('12'),
        toFieldId: createFieldId('10'),
        fromTableId: createTableId('1'),
        toTableId: createTableId('1'),
        kind: 'same_record',
        semantic: 'formula_ref',
      },
    ];

    const result = detectCircularDependency(edges);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toMatch(/circular dependency/i);
    }
  });
});
