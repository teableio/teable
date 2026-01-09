import {
  type Table,
  type TableId,
  type DomainError,
  FieldType,
  type LinkField,
  topologicalSort,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

export type TableDependencyResult = {
  /** Tables in order of creation (dependencies first) */
  orderedTables: ReadonlyArray<Table>;
  /** Detected circular dependencies */
  cycles: ReadonlyArray<ReadonlyArray<TableId>>;
};

/**
 * Analyzes table dependencies via LinkField references and provides
 * topologically sorted order for record creation.
 */
export class TableDependencyAnalyzer {
  /**
   * Analyze tables and return them in topological order based on LinkField dependencies.
   * Tables with link fields pointing to other tables must be created after those tables.
   *
   * @param tables - Array of tables to analyze
   * @returns Tables ordered by dependency (dependencies first) and detected cycles
   */
  static analyze(tables: ReadonlyArray<Table>): Result<TableDependencyResult, DomainError> {
    const tableById = new Map(tables.map((t) => [t.id().toString(), t]));
    const linkFieldType = FieldType.link();

    // Build dependency graph nodes
    const nodes = tables.map((table) => {
      const dependencies: TableId[] = [];

      // Find all link fields in this table
      for (const field of table.getFields()) {
        if (field.type().equals(linkFieldType)) {
          const linkField = field as LinkField;
          const foreignTableId = linkField.foreignTableId();

          // Only add dependency if:
          // 1. The foreign table is in our set (we're generating records for it)
          // 2. It's not a self-reference
          if (tableById.has(foreignTableId.toString()) && !foreignTableId.equals(table.id())) {
            dependencies.push(foreignTableId);
          }
        }
      }

      return { id: table.id(), dependencies };
    });

    // Use existing topological sort utility
    const result = topologicalSort(nodes);

    // Map sorted IDs back to Table objects
    const orderedTables = result.order
      .map((id) => tableById.get(id.toString()))
      .filter((t): t is Table => t !== undefined);

    return ok({
      orderedTables,
      cycles: result.cycles,
    });
  }

  /**
   * Check if a table has any link dependencies to other tables in the set.
   *
   * @param table - Table to check
   * @param tableIds - Set of table IDs we're generating records for
   * @returns Array of foreign table IDs that this table depends on
   */
  static getDependencies(table: Table, tableIds: ReadonlySet<string>): ReadonlyArray<string> {
    const dependencies: string[] = [];
    const linkFieldType = FieldType.link();
    const tableIdStr = table.id().toString();

    for (const field of table.getFields()) {
      if (field.type().equals(linkFieldType)) {
        const linkField = field as LinkField;
        const foreignTableId = linkField.foreignTableId().toString();

        // Add dependency if foreign table is in our set and not self-reference
        if (tableIds.has(foreignTableId) && foreignTableId !== tableIdStr) {
          dependencies.push(foreignTableId);
        }
      }
    }

    return dependencies;
  }
}
