import type { Table } from '@teable/v2-core';
import type {
  ConditionalTargetHitStatistics,
  DataStatisticsSnapshot,
  FieldDataStatistics,
  LinkFanoutStatistics,
  SchemaComplexityAssumptions,
  TableDataStatistics,
} from '@teable/v2-complexity';

/**
 * Key-wise merge of catalog aggregates and caller assumptions.
 *
 * Catalog stays the structural source (tables, fields, links, freshness); a
 * caller key only replaces the matching value and is recorded as a warning.
 * The two inputs are never "all catalog" or "all assumptions"; a caller that
 * supplies `changeRate` keeps every catalog row count.
 */
export type MergedComplexityStatistics = {
  readonly statistics: DataStatisticsSnapshot | null;
  readonly warnings: ReadonlyArray<string>;
};

export type ComplexityConditionalEdge = {
  readonly fromFieldId: string;
  readonly toFieldId: string;
  readonly fromTableId: string;
  readonly toTableId: string;
  readonly linkFieldId?: string | null;
};

type MutableTableStatistics = {
  tableId: string;
  rowCount: number | null;
  avgRowBytes: number | null;
  lastAnalyzeAt: string | null;
  fields: FieldDataStatistics[];
  links: LinkFanoutStatistics[];
  conditionals?: ConditionalTargetHitStatistics[];
};

const toMutableTable = (table: TableDataStatistics): MutableTableStatistics => ({
  tableId: table.tableId,
  rowCount: table.rowCount,
  avgRowBytes: table.avgRowBytes,
  lastAnalyzeAt: table.lastAnalyzeAt,
  fields: [...table.fields],
  links: [...table.links],
  conditionals: [...(table.conditionals ?? [])],
});

const mergeLink = (
  link: LinkFanoutStatistics,
  assumption: NonNullable<SchemaComplexityAssumptions['linkFanout']>[string],
  warnings: string[]
): LinkFanoutStatistics => {
  const applied = (['mean', 'p50', 'p95', 'max'] as const).some(
    (key) => assumption[key] !== undefined
  );
  if (!applied) return link;
  const mean = assumption.mean ?? link.mean;
  const p50 = assumption.p50 ?? link.p50;
  const p95 = assumption.p95 ?? link.p95;
  const max = assumption.max ?? link.max;
  const complete = mean !== null && p50 !== null && p95 !== null && max !== null;
  warnings.push(`assumption-overridden:linkFanout:${link.linkFieldId ?? 'unknown'}`);
  return {
    ...link,
    mean,
    p50,
    p95,
    max,
    method: 'caller',
    source: 'caller',
    completeness: complete ? 'complete' : 'partial',
    confidence: complete ? 'medium' : 'low',
    warnings: [...(link.warnings ?? []), 'caller-assumption-applied'],
  };
};

const mergeRows = (
  tables: MutableTableStatistics[],
  assumptions: SchemaComplexityAssumptions,
  warnings: string[]
): void => {
  const remaining = new Map(Object.entries(assumptions.rowCounts ?? {}));
  for (const table of tables) {
    if (!remaining.has(table.tableId)) continue;
    table.rowCount = remaining.get(table.tableId)!;
    remaining.delete(table.tableId);
    warnings.push(`assumption-overridden:rowCounts:${table.tableId}`);
  }
  for (const [tableId, rowCount] of remaining) {
    warnings.push(`assumption-table-not-in-catalog:${tableId}`);
    void rowCount;
  }
};

const mergeFields = (
  tables: MutableTableStatistics[],
  tableModels: ReadonlyArray<Table>,
  assumptions: SchemaComplexityAssumptions,
  warnings: string[]
): void => {
  const overrides = new Map(Object.entries(assumptions.avgInputRows ?? {}));
  if (overrides.size === 0) return;
  for (const table of tables) {
    table.fields = table.fields.map((field) => {
      if (!overrides.has(field.fieldId)) return field;
      const avgInputRows = overrides.get(field.fieldId)!;
      overrides.delete(field.fieldId);
      warnings.push(`assumption-overridden:avgInputRows:${field.fieldId}`);
      return { ...field, avgInputRows };
    });
  }
  if (overrides.size === 0) return;
  const tableIdByField = new Map<string, string>();
  for (const model of tableModels) {
    for (const field of model.getFields()) {
      tableIdByField.set(field.id().toString(), model.id().toString());
    }
  }
  for (const [fieldId, avgInputRows] of overrides) {
    const tableId = tableIdByField.get(fieldId);
    const table = tableId ? tables.find((candidate) => candidate.tableId === tableId) : undefined;
    if (!table) {
      warnings.push(`assumption-unknown-field:${fieldId}`);
      continue;
    }
    table.fields = [
      ...table.fields,
      { fieldId, nDistinct: null, nullFraction: null, avgWidth: null, avgInputRows },
    ];
    warnings.push(`assumption-overridden:avgInputRows:${fieldId}`);
  }
};

const mergeLinks = (
  tables: MutableTableStatistics[],
  assumptions: SchemaComplexityAssumptions,
  warnings: string[]
): void => {
  const fanout = assumptions.linkFanout ?? {};
  const linkIds = Object.keys(fanout);
  if (linkIds.length === 0) return;
  const applied = new Set<string>();
  for (const table of tables) {
    table.links = table.links.map((link) => {
      const linkFieldId = link.linkFieldId;
      if (!linkFieldId || !fanout[linkFieldId]) return link;
      applied.add(linkFieldId);
      return mergeLink(link, fanout[linkFieldId]!, warnings);
    });
  }
  for (const linkFieldId of linkIds) {
    if (!applied.has(linkFieldId)) {
      warnings.push(`assumption-link-not-in-catalog:${linkFieldId}`);
    }
  }
};

const mergeConditionals = (
  tables: MutableTableStatistics[],
  assumptions: SchemaComplexityAssumptions,
  edges: ReadonlyArray<ComplexityConditionalEdge>,
  warnings: string[]
): void => {
  const overrides = assumptions.conditionalTargetHitFractions ?? {};
  for (const [targetFieldId, assumption] of Object.entries(overrides)) {
    let applied = false;
    for (const table of tables) {
      table.conditionals = (table.conditionals ?? []).map((entry) => {
        if (entry.toFieldId !== targetFieldId) return entry;
        applied = true;
        return {
          ...entry,
          fraction: assumption.fraction,
          sourceDirtyCount: assumption.sourceDirtyCount,
          includesBeforeImage: assumption.includesBeforeImage,
          source: 'caller' as const,
          completeness: 'complete' as const,
          confidence: 'medium' as const,
          warnings: [...(entry.warnings ?? []), 'caller-assumption-applied'],
        };
      });
    }
    if (applied) {
      warnings.push(`assumption-overridden:conditionalTargetHitFractions:${targetFieldId}`);
      continue;
    }
    const edge = edges.find((candidate) => candidate.toFieldId === targetFieldId);
    const host = edge ? tables.find((table) => table.tableId === edge.toTableId) : undefined;
    if (!edge || !host) {
      warnings.push(`assumption-unknown-conditional-target:${targetFieldId}`);
      continue;
    }
    host.conditionals = [
      ...(host.conditionals ?? []),
      {
        fromTableId: edge.fromTableId,
        toTableId: edge.toTableId,
        fromFieldId: edge.fromFieldId,
        toFieldId: edge.toFieldId,
        linkFieldId: edge.linkFieldId ?? null,
        fraction: assumption.fraction,
        sourceDirtyCount: assumption.sourceDirtyCount,
        includesBeforeImage: assumption.includesBeforeImage,
        source: 'caller',
        completeness: 'complete',
        confidence: 'medium',
        warnings: ['caller-assumption-applied'],
      },
    ];
    warnings.push(`assumption-overridden:conditionalTargetHitFractions:${targetFieldId}`);
  }
};

export function mergeComplexityStatistics(input: {
  readonly catalog: DataStatisticsSnapshot | null;
  readonly assumptions: SchemaComplexityAssumptions;
  readonly tables: ReadonlyArray<Table>;
  readonly conditionalEdges?: ReadonlyArray<ComplexityConditionalEdge>;
}): MergedComplexityStatistics {
  if (input.catalog === null) {
    return { statistics: null, warnings: [] };
  }

  const assumptions = input.assumptions;
  const warnings: string[] = [];
  const primary = toMutableTable(input.catalog);
  const related = (input.catalog.relatedTables ?? []).map(toMutableTable);
  const allTables = [primary, ...related];

  if (assumptions.rowCounts !== undefined) mergeRows(allTables, assumptions, warnings);
  if (assumptions.avgInputRows !== undefined) {
    mergeFields(allTables, input.tables, assumptions, warnings);
  }
  if (assumptions.linkFanout !== undefined) mergeLinks(allTables, assumptions, warnings);
  if (assumptions.conditionalTargetHitFractions !== undefined) {
    mergeConditionals(allTables, assumptions, input.conditionalEdges ?? [], warnings);
  }
  if (assumptions.changeRate !== undefined) {
    warnings.push('assumption-overridden:changeRate');
  }
  if (assumptions.capturedAt !== undefined) {
    warnings.push('assumption-overridden:capturedAt');
  }
  if (assumptions.seedRecordCount !== undefined) {
    warnings.push('assumption-overridden:seedRecordCount');
  }

  const [mergedPrimary, ...mergedRelated] = allTables;
  const assumptionsApplied = warnings.some((warning) => warning.startsWith('assumption-overridden:'));
  if (!assumptionsApplied) {
    return { statistics: input.catalog, warnings };
  }

  return {
    statistics: {
      ...mergedPrimary!,
      relatedTables: mergedRelated,
      capturedAt: assumptions.capturedAt ?? input.catalog.capturedAt,
      source: 'caller',
      completeness: 'partial',
      confidence:
        input.catalog.confidence === 'high' ? 'medium' : input.catalog.confidence,
      changeRate:
        assumptions.changeRate === undefined
          ? (input.catalog.changeRate ?? null)
          : assumptions.changeRate,
      warnings: [...(input.catalog.warnings ?? []), ...warnings],
    },
    warnings,
  };
}
