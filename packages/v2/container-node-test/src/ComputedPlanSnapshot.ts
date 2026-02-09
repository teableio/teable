/* eslint-disable @typescript-eslint/naming-convention */
import type { ComputedPlanLogEntry } from './SpyLogger';

/**
 * A structured snapshot of computed steps for JSON assertions.
 */
export interface ComputedStepsSnapshot {
  stepCount: number;
  steps: Array<{
    level: number;
    table: string;
    fields: string[];
  }>;
  edgeCount: number;
}

export interface ComputedPlanSnapshotOptions {
  /** Map of table IDs to human-readable table names */
  tableNames?: Map<string, string>;
  /** Map of field IDs to human-readable field names */
  fieldNames?: Map<string, string>;
}

/**
 * Format computed plan as a human-readable string for inline snapshots.
 *
 * @example
 * ```typescript
 * expect(printComputedSteps(plan, { tableNames, fieldNames }))
 *   .toMatchInlineSnapshot(`
 *     "[Computed Steps: 1]
 *       L1: TableA -> [Formula1]"
 *   `);
 * ```
 */
export const printComputedSteps = (
  plan: ComputedPlanLogEntry,
  options?: ComputedPlanSnapshotOptions
): string => {
  const { tableNames, fieldNames } = options ?? {};
  const resolveTable = (id: string) => tableNames?.get(id) ?? id;
  const resolveField = (id: string) => fieldNames?.get(id) ?? id;

  const lines: string[] = [`[Computed Steps: ${plan.steps.length}]`];

  for (const step of plan.steps) {
    const fields = step.fieldIds
      .map(resolveField)
      .sort((a, b) => a.localeCompare(b))
      .join(', ');
    lines.push(`  L${step.level}: ${resolveTable(step.tableId)} -> [${fields}]`);
  }

  if (plan.edges.length > 0) {
    lines.push(`[Edges: ${plan.edges.length}]`);
  }

  return lines.join('\n');
};

/**
 * Format computed plan as a structured object for JSON snapshot assertions.
 *
 * @example
 * ```typescript
 * expect(formatComputedPlanSnapshot(plan, { tableNames, fieldNames }))
 *   .toMatchInlineSnapshot(`
 *     {
 *       "stepCount": 1,
 *       "steps": [{ "level": 1, "table": "TableA", "fields": ["Formula1"] }],
 *       "edgeCount": 0
 *     }
 *   `);
 * ```
 */
export const formatComputedPlanSnapshot = (
  plan: ComputedPlanLogEntry,
  options?: ComputedPlanSnapshotOptions
): ComputedStepsSnapshot => {
  const { tableNames, fieldNames } = options ?? {};
  const resolveTable = (id: string) => tableNames?.get(id) ?? id;
  const resolveField = (id: string) => fieldNames?.get(id) ?? id;

  return {
    stepCount: plan.steps.length,
    steps: plan.steps.map((s) => ({
      level: s.level,
      table: resolveTable(s.tableId),
      fields: s.fieldIds.map(resolveField).sort((a, b) => a.localeCompare(b)),
    })),
    edgeCount: plan.edges.length,
  };
};

/**
 * Helper to build name maps from a single table and its fields.
 *
 * @example
 * ```typescript
 * const { tableNames, fieldNames } = buildNameMaps(
 *   { id: table.id, name: 'MyTable' },
 *   [
 *     { id: nameFieldId, name: 'Name' },
 *     { id: valueFieldId, name: 'Value' },
 *   ]
 * );
 * ```
 */
export const buildNameMaps = (
  table: { id: string; name: string },
  fields: Array<{ id: string; name: string }>
): ComputedPlanSnapshotOptions => ({
  tableNames: new Map([[table.id, table.name]]),
  fieldNames: new Map(fields.map((f) => [f.id, f.name])),
});

/**
 * Helper to build name maps from multiple tables and their fields.
 *
 * @example
 * ```typescript
 * const { tableNames, fieldNames } = buildMultiTableNameMaps([
 *   {
 *     id: sourceTable.id,
 *     name: 'Source',
 *     fields: [{ id: sourceValueFieldId, name: 'Value' }]
 *   },
 *   {
 *     id: targetTable.id,
 *     name: 'Target',
 *     fields: [
 *       { id: linkFieldId, name: 'Link' },
 *       { id: lookupFieldId, name: 'LookupValue' },
 *     ]
 *   },
 * ]);
 * ```
 */
export const buildMultiTableNameMaps = (
  tables: Array<{
    id: string;
    name: string;
    fields: Array<{ id: string; name: string }>;
  }>
): ComputedPlanSnapshotOptions => {
  const tableNames = new Map<string, string>();
  const fieldNames = new Map<string, string>();
  for (const table of tables) {
    tableNames.set(table.id, table.name);
    for (const field of table.fields) {
      fieldNames.set(field.id, field.name);
    }
  }
  return { tableNames, fieldNames };
};
