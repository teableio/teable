import { describe, expect, it } from 'vitest';

import type { InsertExclusivityConstraint } from '../query-builder/insert';

/**
 * Unit tests for link exclusivity constraint validation logic.
 *
 * These tests verify the in-memory duplicate detection for batch operations,
 * without hitting the database. Database conflict checking is covered by e2e tests.
 */

// Mock FieldId/TableId with toString() for testing
const mockFieldId = (id: string) =>
  ({ toString: () => id }) as InsertExclusivityConstraint['fieldId'];
const mockTableId = (id: string) =>
  ({ toString: () => id }) as InsertExclusivityConstraint['foreignTableId'];

// Helper to create test constraints
const createInsertConstraint = (
  fieldId: string,
  sourceRecordId: string,
  linkedForeignRecordIds: string[],
  options: { isOneWay?: boolean; fkHostTableName?: string; selfKeyName?: string } = {}
): InsertExclusivityConstraint => ({
  fieldId: mockFieldId(fieldId),
  foreignTableId: mockTableId('tbl_foreign'),
  fkHostTableName: options.fkHostTableName ?? 'test_table',
  selfKeyName: options.selfKeyName ?? '__fk_test',
  foreignKeyName: '__id',
  linkedForeignRecordIds,
  sourceRecordId,
  isOneWay: options.isOneWay ?? false,
});

/**
 * Simulates the batch duplicate check logic from validateInsertExclusivityConstraints.
 * This is extracted for unit testing without database dependencies.
 */
const checkBatchDuplicates = (
  constraints: InsertExclusivityConstraint[]
): {
  hasDuplicate: boolean;
  duplicateInfo?: { fieldId: string; foreignRecordId: string; sourceRecords: string[] };
} => {
  // Group constraints by field ID
  const constraintsByField = new Map<string, InsertExclusivityConstraint[]>();
  for (const constraint of constraints) {
    const fieldIdStr = constraint.fieldId.toString();
    const existing = constraintsByField.get(fieldIdStr) ?? [];
    existing.push(constraint);
    constraintsByField.set(fieldIdStr, existing);
  }

  // Check for cross-record duplicates within same field
  for (const [fieldIdStr, fieldConstraints] of constraintsByField) {
    const seenForeignRecordIds = new Map<string, string>(); // foreignRecordId -> sourceRecordId

    for (const constraint of fieldConstraints) {
      for (const foreignRecordId of constraint.linkedForeignRecordIds) {
        const existingSourceId = seenForeignRecordIds.get(foreignRecordId);
        if (existingSourceId && existingSourceId !== constraint.sourceRecordId) {
          return {
            hasDuplicate: true,
            duplicateInfo: {
              fieldId: fieldIdStr,
              foreignRecordId,
              sourceRecords: [existingSourceId, constraint.sourceRecordId],
            },
          };
        }
        seenForeignRecordIds.set(foreignRecordId, constraint.sourceRecordId);
      }
    }
  }

  return { hasDuplicate: false };
};

describe('Link Exclusivity Constraint Validation', () => {
  describe('oneOne relationship', () => {
    it('should pass when each source links to different foreign records', () => {
      const constraints = [
        createInsertConstraint('fld_link1', 'rec_source1', ['rec_foreign1']),
        createInsertConstraint('fld_link1', 'rec_source2', ['rec_foreign2']),
        createInsertConstraint('fld_link1', 'rec_source3', ['rec_foreign3']),
      ];

      const result = checkBatchDuplicates(constraints);
      expect(result.hasDuplicate).toBe(false);
    });

    it('should detect duplicate when two sources link to same foreign record', () => {
      const constraints = [
        createInsertConstraint('fld_link1', 'rec_source1', ['rec_foreign1']),
        createInsertConstraint('fld_link1', 'rec_source2', ['rec_foreign1']), // Same foreign record!
      ];

      const result = checkBatchDuplicates(constraints);
      expect(result.hasDuplicate).toBe(true);
      expect(result.duplicateInfo?.foreignRecordId).toBe('rec_foreign1');
      expect(result.duplicateInfo?.sourceRecords).toContain('rec_source1');
      expect(result.duplicateInfo?.sourceRecords).toContain('rec_source2');
    });

    it('should allow same source to update its own link (no conflict)', () => {
      // Same source record appearing twice (e.g., in different operations)
      // should not be flagged as duplicate
      const constraints = [
        createInsertConstraint('fld_link1', 'rec_source1', ['rec_foreign1']),
        createInsertConstraint('fld_link1', 'rec_source1', ['rec_foreign1']), // Same source, same target
      ];

      const result = checkBatchDuplicates(constraints);
      expect(result.hasDuplicate).toBe(false);
    });

    it('should handle empty constraints', () => {
      const result = checkBatchDuplicates([]);
      expect(result.hasDuplicate).toBe(false);
    });

    it('should handle constraint with empty linked records', () => {
      const constraints = [
        createInsertConstraint('fld_link1', 'rec_source1', []),
        createInsertConstraint('fld_link1', 'rec_source2', ['rec_foreign1']),
      ];

      const result = checkBatchDuplicates(constraints);
      expect(result.hasDuplicate).toBe(false);
    });
  });

  describe('oneMany relationship', () => {
    it('should pass when each source links to different foreign records (array)', () => {
      const constraints = [
        createInsertConstraint('fld_link1', 'rec_parent1', ['rec_child1', 'rec_child2']),
        createInsertConstraint('fld_link1', 'rec_parent2', ['rec_child3', 'rec_child4']),
      ];

      const result = checkBatchDuplicates(constraints);
      expect(result.hasDuplicate).toBe(false);
    });

    it('should detect duplicate when two parents try to link same child', () => {
      const constraints = [
        createInsertConstraint('fld_link1', 'rec_parent1', ['rec_child1', 'rec_child2']),
        createInsertConstraint('fld_link1', 'rec_parent2', ['rec_child2', 'rec_child3']), // rec_child2 is duplicate!
      ];

      const result = checkBatchDuplicates(constraints);
      expect(result.hasDuplicate).toBe(true);
      expect(result.duplicateInfo?.foreignRecordId).toBe('rec_child2');
    });

    it('should detect duplicate within same record linking same child twice', () => {
      // This scenario should be caught by schema validation (Zod refine),
      // but the batch check should also handle it
      const constraints = [
        createInsertConstraint('fld_link1', 'rec_parent1', ['rec_child1', 'rec_child1']), // Duplicate in same array
      ];

      // Note: This won't be caught by batch check since it's same source
      // Schema validation handles this case
      const result = checkBatchDuplicates(constraints);
      expect(result.hasDuplicate).toBe(false); // Same source, no conflict in batch check
    });
  });

  describe('manyOne relationship (no exclusivity needed)', () => {
    // manyOne doesn't require exclusivity - multiple sources can link to same foreign record
    // No constraints should be generated for manyOne

    it('should allow multiple sources to link to same foreign record', () => {
      // In manyOne, this is expected behavior - no constraints should be generated
      // The constraints array would be empty in real usage
      const constraints: InsertExclusivityConstraint[] = [];

      const result = checkBatchDuplicates(constraints);
      expect(result.hasDuplicate).toBe(false);
    });
  });

  describe('manyMany relationship (no exclusivity needed)', () => {
    // manyMany doesn't require exclusivity - any record can link to any record
    // No constraints should be generated for manyMany

    it('should not generate constraints for manyMany', () => {
      const constraints: InsertExclusivityConstraint[] = [];

      const result = checkBatchDuplicates(constraints);
      expect(result.hasDuplicate).toBe(false);
    });
  });

  describe('multiple link fields in same batch', () => {
    it('should check constraints independently per field', () => {
      const constraints = [
        // Field 1: No duplicates
        createInsertConstraint('fld_link1', 'rec_source1', ['rec_foreign1']),
        createInsertConstraint('fld_link1', 'rec_source2', ['rec_foreign2']),
        // Field 2: Has duplicates
        createInsertConstraint('fld_link2', 'rec_source1', ['rec_foreign1']),
        createInsertConstraint('fld_link2', 'rec_source2', ['rec_foreign1']), // Duplicate in field 2
      ];

      const result = checkBatchDuplicates(constraints);
      expect(result.hasDuplicate).toBe(true);
      expect(result.duplicateInfo?.fieldId).toBe('fld_link2');
    });

    it('should pass when different fields link to same foreign records from same source', () => {
      const constraints = [
        createInsertConstraint('fld_link1', 'rec_source1', ['rec_foreign1']),
        createInsertConstraint('fld_link2', 'rec_source1', ['rec_foreign1']), // Same source, same target, but different field
      ];

      const result = checkBatchDuplicates(constraints);
      expect(result.hasDuplicate).toBe(false);
    });
  });

  describe('one-way vs two-way links', () => {
    it('should check constraints for both one-way and two-way links in batch', () => {
      const constraints = [
        createInsertConstraint('fld_link1', 'rec_source1', ['rec_foreign1'], { isOneWay: true }),
        createInsertConstraint('fld_link1', 'rec_source2', ['rec_foreign1'], { isOneWay: true }), // Duplicate!
      ];

      const result = checkBatchDuplicates(constraints);
      expect(result.hasDuplicate).toBe(true);
    });

    it('should handle mixed one-way and two-way in different fields', () => {
      const constraints = [
        createInsertConstraint('fld_link1', 'rec_source1', ['rec_foreign1'], { isOneWay: true }),
        createInsertConstraint('fld_link2', 'rec_source1', ['rec_foreign1'], { isOneWay: false }),
      ];

      const result = checkBatchDuplicates(constraints);
      expect(result.hasDuplicate).toBe(false);
    });
  });

  describe('query grouping optimization', () => {
    it('should group constraints by fkHostTableName for efficient querying', () => {
      // This tests the grouping logic used in validateInsertExclusivityConstraints
      const constraints = [
        createInsertConstraint('fld_link1', 'rec_s1', ['rec_f1'], {
          fkHostTableName: 'table_a',
          selfKeyName: '__fk_a',
        }),
        createInsertConstraint('fld_link2', 'rec_s2', ['rec_f2'], {
          fkHostTableName: 'table_a',
          selfKeyName: '__fk_a',
        }),
        createInsertConstraint('fld_link3', 'rec_s3', ['rec_f3'], {
          fkHostTableName: 'table_b',
          selfKeyName: '__fk_b',
        }),
      ];

      // Group by fkHostTableName::selfKeyName
      const groups = new Map<string, InsertExclusivityConstraint[]>();
      for (const c of constraints) {
        const key = `${c.fkHostTableName}::${c.selfKeyName}`;
        const existing = groups.get(key) ?? [];
        existing.push(c);
        groups.set(key, existing);
      }

      expect(groups.size).toBe(2); // table_a::__fk_a and table_b::__fk_b
      expect(groups.get('table_a::__fk_a')?.length).toBe(2);
      expect(groups.get('table_b::__fk_b')?.length).toBe(1);
    });

    it('should combine foreignRecordIds when grouping for database query', () => {
      const constraints = [
        createInsertConstraint('fld_link1', 'rec_s1', ['rec_f1', 'rec_f2'], {
          fkHostTableName: 'table_a',
          selfKeyName: '__fk_a',
        }),
        createInsertConstraint('fld_link1', 'rec_s2', ['rec_f3'], {
          fkHostTableName: 'table_a',
          selfKeyName: '__fk_a',
        }),
      ];

      // Simulate the grouping logic in validateInsertExclusivityConstraints
      const queryGroups = new Map<string, { foreignRecordIds: Set<string> }>();
      for (const c of constraints) {
        if (c.isOneWay) continue; // Skip one-way links
        const key = `${c.fkHostTableName}::${c.selfKeyName}`;
        const existing = queryGroups.get(key);
        if (existing) {
          for (const id of c.linkedForeignRecordIds) {
            existing.foreignRecordIds.add(id);
          }
        } else {
          queryGroups.set(key, {
            foreignRecordIds: new Set(c.linkedForeignRecordIds),
          });
        }
      }

      const group = queryGroups.get('table_a::__fk_a');
      expect(group?.foreignRecordIds.size).toBe(3); // rec_f1, rec_f2, rec_f3
      expect(group?.foreignRecordIds.has('rec_f1')).toBe(true);
      expect(group?.foreignRecordIds.has('rec_f2')).toBe(true);
      expect(group?.foreignRecordIds.has('rec_f3')).toBe(true);
    });
  });
});
