import { domainError, type DomainError, type IExecutionContext, type Table } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

/**
 * Structural mirror of command-explain's DataStatisticsSnapshot. The adapter
 * deliberately does not import command-explain (that package depends on this
 * adapter); the collector accepts this object structurally.
 */
export type PostgresComplexityStatisticsSnapshot = {
  readonly tableId: string;
  readonly rowCount: number | null;
  readonly avgRowBytes: number | null;
  readonly lastAnalyzeAt: string | null;
  readonly fields: ReadonlyArray<{
    readonly fieldId: string;
    readonly nDistinct: number | null;
    readonly nullFraction: number | null;
    readonly avgWidth: number | null;
    readonly avgInputRows: number | null;
  }>;
  readonly links: ReadonlyArray<{
    readonly fromTableId: string;
    readonly toTableId: string;
    readonly linkFieldId: string | null;
    readonly mean: number | null;
    readonly p50: number | null;
    readonly p95: number | null;
    readonly max: number | null;
    readonly method: 'catalog' | 'sample' | 'unknown';
    readonly source: 'pg_catalog' | 'pg_stats' | 'sample' | 'caller' | 'unknown';
    readonly completeness: 'complete' | 'partial' | 'unknown';
    readonly confidence: 'high' | 'medium' | 'low';
    readonly warnings?: ReadonlyArray<string>;
  }>;
  /**
   * Exact conditional target-hit evidence. The catalog reader has no
   * conditional dirty-batch measurements, so it omits this collection.
   */
  readonly conditionals?: ReadonlyArray<{
    readonly fromTableId: string;
    readonly toTableId: string;
    readonly fromFieldId: string;
    readonly toFieldId: string;
    readonly linkFieldId: string | null;
    readonly fraction: number | null;
    readonly sourceDirtyCount: number | null;
    readonly includesBeforeImage: boolean;
    readonly source: 'pg_catalog' | 'pg_stats' | 'sample' | 'caller' | 'unknown';
    readonly completeness: 'complete' | 'partial' | 'unknown';
    readonly confidence: 'high' | 'medium' | 'low';
    readonly warnings?: ReadonlyArray<string>;
  }>;
  readonly relatedTables?: ReadonlyArray<PostgresComplexityTableStatistics>;
  readonly capturedAt: string;
  readonly source: 'pg_catalog' | 'pg_stats' | 'sample' | 'caller' | 'unknown';
  readonly completeness: 'complete' | 'partial' | 'unknown';
  readonly confidence: 'high' | 'medium' | 'low';
  readonly warnings?: ReadonlyArray<string>;
  readonly changeRate?: number | null;
};

export type PostgresComplexityTableStatistics = {
  readonly tableId: string;
  readonly rowCount: number | null;
  readonly avgRowBytes: number | null;
  readonly lastAnalyzeAt: string | null;
  readonly fields: PostgresComplexityStatisticsSnapshot['fields'];
  readonly links: PostgresComplexityStatisticsSnapshot['links'];
  readonly completeness: 'complete' | 'partial' | 'unknown';
  readonly confidence: 'high' | 'medium' | 'low';
  readonly warnings: ReadonlyArray<string>;
};

export type PostgresComplexityStatisticsOptions = {
  /** Catalog mean only; no unbounded sampling is performed. */
  readonly includeLinkFanout?: boolean;
  /**
   * Bounded parallelism for catalog reads. Every unit of work is one or two
   * read-only pg_catalog/pg_stats queries, so this caps concurrent statements.
   */
  readonly concurrency?: number;
  /**
   * Hard ceiling for one collection. A base wider than this is rejected instead
   * of issuing an unbounded serial scan from an HTTP request.
   */
  readonly maxTables?: number;
};

export const COMPLEXITY_STATISTICS_DEFAULT_CONCURRENCY = 4;
export const COMPLEXITY_STATISTICS_MAX_TABLES = 500;

const boundedConcurrency = (value: number | undefined, fallback: number): number => {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(16, Math.floor(value)));
};

const mapWithConcurrency = async <TInput, TOutput>(
  items: ReadonlyArray<TInput>,
  concurrency: number,
  work: (item: TInput) => Promise<TOutput>
): Promise<TOutput[]> => {
  const results = new Array<TOutput>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await work(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
};

type TableStatsRow = {
  readonly row_count: number | string | null;
  readonly relpages: number | string | null;
  readonly last_analyze: Date | string | null;
};

type FieldStatsRow = {
  readonly attname: string;
  readonly n_distinct: number | string | null;
  readonly null_frac: number | string | null;
  readonly avg_width: number | string | null;
};

type RelationRowsRow = {
  readonly row_count: number | string | null;
};

type LinkFieldLike = {
  id(): { toString(): string };
  relationship(): { toString(): string };
  foreignTableId(): { toString(): string };
  fkHostTableNameString(): Result<string, DomainError>;
};

const BLOCK_SIZE_BYTES = 8192;

const toNumber = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parsePhysicalName = (name: string): { schema: string; table: string } => {
  const separator = name.lastIndexOf('.');
  return separator > 0
    ? { schema: name.slice(0, separator), table: name.slice(separator + 1) }
    : { schema: 'public', table: name };
};

const relationRowCount = async (
  db: Kysely<V1TeableDatabase>,
  physicalName: string
): Promise<number | null> => {
  const { schema, table } = parsePhysicalName(physicalName);
  const rows = await sql<RelationRowsRow>`
    SELECT c.reltuples AS row_count
    FROM pg_class c
    INNER JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${schema} AND c.relname = ${table}
    LIMIT 1
  `.execute(db);
  return toNumber(rows.rows[0]?.row_count);
};

/**
 * Read-only, opt-in catalog reader. It never returns MCV arrays, raw samples or
 * record values, and is never invoked by the default explain path.
 *
 * Link fanout is emitted in propagation direction. For a host table A holding a
 * link field to foreign table B, the output edge is B -> A with A's linkFieldId.
 */
export class PostgresComplexityStatisticsReader {
  constructor(private readonly db: Kysely<V1TeableDatabase>) {}

  async collect(
    context: IExecutionContext,
    table: Table,
    options: PostgresComplexityStatisticsOptions = {}
  ): Promise<Result<PostgresComplexityStatisticsSnapshot, DomainError>> {
    return this.collectMany(context, [table], options);
  }

  async collectMany(
    _context: IExecutionContext,
    tables: ReadonlyArray<Table>,
    options: PostgresComplexityStatisticsOptions = {}
  ): Promise<Result<PostgresComplexityStatisticsSnapshot, DomainError>> {
    if (tables.length === 0) {
      return err(domainError.validation({ message: 'Statistics collection needs a table' }));
    }
    const maxTables = options.maxTables ?? COMPLEXITY_STATISTICS_MAX_TABLES;
    if (tables.length > maxTables) {
      return err(
        domainError.validation({
          code: 'complexity.catalog.too_many_tables',
          message: `Catalog statistics cover ${tables.length} tables; the limit is ${maxTables}. Narrow the request or profile a single table.`,
        })
      );
    }
    const concurrency = boundedConcurrency(
      options.concurrency,
      COMPLEXITY_STATISTICS_DEFAULT_CONCURRENCY
    );
    try {
      // Catalog reads are bounded-parallel: a base with N tables issues at most
      // `concurrency` concurrent read-only statements instead of N serial ones.
      const stats = await mapWithConcurrency(tables, concurrency, (table) =>
        this.loadTableStats(table)
      );
      const byTableId = new Map(stats.map((entry) => [entry.tableId, entry]));
      const primary = stats[0]!;
      const linksBySource = new Map<
        string,
        PostgresComplexityStatisticsSnapshot['links'][number][]
      >();
      const linkWarnings = new Map<string, string[]>();

      if (options.includeLinkFanout !== false) {
        const linkTasks = tables.flatMap((table) => {
          const host = byTableId.get(table.id().toString());
          if (!host) return [];
          return table
            .getFields()
            .filter((field) => field.type().toString() === 'link')
            .map((field) => {
              const linkField = field as unknown as LinkFieldLike;
              const targetTableId = linkField.foreignTableId().toString();
              return {
                linkField,
                host,
                target: byTableId.get(targetTableId),
                fieldStats: host.fields.find(
                  (candidate) => candidate.fieldId === field.id().toString()
                ),
              };
            });
        });
        const computedLinks = await mapWithConcurrency(linkTasks, concurrency, (task) =>
          this.computeReverseFanout(task)
        );
        for (const [index, task] of linkTasks.entries()) {
          const computed = computedLinks[index]!;
          const targetTableId = task.linkField.foreignTableId().toString();
          const sourceTableId = task.target ? task.target.tableId : primary.tableId;
          const list = linksBySource.get(sourceTableId) ?? [];
          list.push({
            fromTableId: targetTableId,
            toTableId: task.host.tableId,
            linkFieldId: task.linkField.id().toString(),
            mean: computed.mean,
            p50: null,
            p95: null,
            max: null,
            method: computed.mean === null ? 'unknown' : 'catalog',
            source: 'pg_catalog',
            completeness: computed.mean === null ? 'unknown' : 'partial',
            confidence: computed.mean === null ? 'low' : 'medium',
            warnings: computed.warnings,
          });
          linksBySource.set(sourceTableId, list);
          if (computed.mean === null) {
            const warnings = linkWarnings.get(task.host.tableId) ?? [];
            warnings.push(`link-fanout-missing:${task.linkField.id().toString()}`);
            linkWarnings.set(task.host.tableId, warnings);
          }
        }
      }

      const withLinks = (
        entry: PostgresComplexityTableStatistics
      ): PostgresComplexityTableStatistics => {
        const links = linksBySource.get(entry.tableId) ?? [];
        const warnings = [...entry.warnings, ...(linkWarnings.get(entry.tableId) ?? [])];
        const linkIncomplete = links.some((link) => link.completeness !== 'complete');
        const completeness: 'complete' | 'partial' | 'unknown' = linkIncomplete
          ? 'partial'
          : entry.completeness;
        return {
          ...entry,
          links,
          warnings,
          completeness,
          confidence:
            completeness === 'complete' ? 'high' : entry.rowCount === null ? 'low' : 'medium',
        };
      };

      const primaryWithLinks = withLinks(primary);
      const related = stats.slice(1).map(withLinks);
      const relatedIncomplete = related.some((table) => table.completeness !== 'complete');
      const warnings = [...primaryWithLinks.warnings];
      if (relatedIncomplete) warnings.push('related-table-statistics-partial');

      return ok({
        ...primaryWithLinks,
        relatedTables: related,
        capturedAt: new Date().toISOString(),
        source: 'pg_catalog',
        completeness: relatedIncomplete ? 'partial' : primaryWithLinks.completeness,
        confidence: relatedIncomplete
          ? primaryWithLinks.confidence === 'high'
            ? 'medium'
            : primaryWithLinks.confidence
          : primaryWithLinks.confidence,
        warnings,
        changeRate: null,
      });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to read complexity statistics: ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      );
    }
  }

  private async loadTableStats(table: Table): Promise<PostgresComplexityTableStatistics> {
    const dbTableName = table.dbTableName();
    if (dbTableName.isErr()) throw dbTableName.error;
    const name = dbTableName.value.value();
    if (name.isErr()) throw name.error;
    const { schema, table: physicalTable } = parsePhysicalName(name.value);

    const tableRows = await sql<TableStatsRow>`
      SELECT c.reltuples AS row_count, c.relpages,
             s.last_analyze AS last_analyze
      FROM pg_class c
      INNER JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s
        ON s.schemaname = n.nspname AND s.relname = c.relname
      WHERE n.nspname = ${schema} AND c.relname = ${physicalTable}
      LIMIT 1
    `.execute(this.db);
    const row = tableRows.rows[0];
    const rawRowCount = toNumber(row?.row_count);
    const rowCount = rawRowCount !== null && rawRowCount >= 0 ? rawRowCount : null;
    const relpages = toNumber(row?.relpages);
    const avgRowBytes =
      rowCount !== null && rowCount > 0 && relpages !== null
        ? (relpages * BLOCK_SIZE_BYTES) / rowCount
        : null;
    const lastAnalyzeAt = row?.last_analyze ? new Date(row.last_analyze).toISOString() : null;

    const fieldRows = await sql<FieldStatsRow>`
      SELECT attname, n_distinct, null_frac, avg_width
      FROM pg_stats
      WHERE schemaname = ${schema} AND tablename = ${physicalTable}
    `.execute(this.db);
    const statsByColumn = new Map(fieldRows.rows.map((field) => [field.attname, field]));

    const fields: Array<PostgresComplexityStatisticsSnapshot['fields'][number]> = [];
    for (const field of table.getFields()) {
      const dbFieldName = field.dbFieldName();
      if (dbFieldName.isErr()) continue;
      const column = dbFieldName.value.value();
      if (column.isErr()) continue;
      const stats = statsByColumn.get(column.value);
      if (!stats) continue;
      const rawDistinct = toNumber(stats.n_distinct);
      const nDistinct =
        rawDistinct === null
          ? null
          : rawDistinct < 0
            ? rowCount === null
              ? null
              : Math.abs(rawDistinct) * rowCount
            : rawDistinct;
      fields.push({
        fieldId: field.id().toString(),
        nDistinct,
        nullFraction: toNumber(stats.null_frac),
        avgWidth: toNumber(stats.avg_width),
        avgInputRows: null,
      });
    }

    const warnings: string[] = [];
    const fieldStatsMissing = table
      .getFields()
      .some((field) => !fields.some((candidate) => candidate.fieldId === field.id().toString()));
    if (fieldStatsMissing) warnings.push('field-statistics-missing');
    if (rowCount === null) warnings.push('row-count-unknown');
    const completeness =
      rowCount === null || fields.length === 0 || fieldStatsMissing ? 'partial' : 'complete';

    return {
      tableId: table.id().toString(),
      rowCount,
      avgRowBytes,
      lastAnalyzeAt,
      fields,
      links: [],
      completeness,
      confidence: rowCount === null ? 'low' : completeness === 'complete' ? 'high' : 'medium',
      warnings,
    };
  }

  private async computeReverseFanout(input: {
    readonly linkField: LinkFieldLike;
    readonly host: PostgresComplexityTableStatistics;
    readonly target?: PostgresComplexityTableStatistics;
    readonly fieldStats?: PostgresComplexityStatisticsSnapshot['fields'][number];
  }): Promise<{ mean: number | null; warnings: ReadonlyArray<string> }> {
    const relationship = input.linkField.relationship().toString();
    const hostRows = input.host.rowCount;
    const nonNullFraction =
      input.fieldStats?.nullFraction === null || input.fieldStats?.nullFraction === undefined
        ? null
        : 1 - input.fieldStats.nullFraction;
    const nonNullHostRows =
      hostRows !== null && nonNullFraction !== null ? hostRows * nonNullFraction : null;

    if (relationship === 'manyOne') {
      const distinctTargets = input.fieldStats?.nDistinct ?? null;
      return {
        mean:
          nonNullHostRows !== null && distinctTargets !== null && distinctTargets > 0
            ? nonNullHostRows / distinctTargets
            : null,
        warnings: ['catalog-fk-distinct-approximation', 'p95-sampling-disabled'],
      };
    }
    if (relationship === 'oneOne') {
      const targetRows = input.target?.rowCount ?? null;
      if (nonNullHostRows !== null && targetRows !== null && targetRows > 0) {
        return {
          mean: Math.min(1, nonNullHostRows / targetRows),
          warnings: ['link-one-one-upper-bound', 'p95-sampling-disabled'],
        };
      }
      return {
        mean: null,
        warnings: ['link-one-one-missing-denominator', 'p95-sampling-disabled'],
      };
    }
    if (relationship === 'oneMany') {
      return { mean: 1, warnings: ['link-one-many-reverse-one', 'p95-sampling-disabled'] };
    }

    const targetRows = input.target?.rowCount ?? null;
    const fkHostName = input.linkField.fkHostTableNameString();
    if (!fkHostName.isOk()) {
      return { mean: null, warnings: ['junction-relation-missing'] };
    }
    const relationRows = await relationRowCount(this.db, fkHostName.value);
    return {
      mean:
        relationRows !== null && targetRows !== null && targetRows > 0
          ? relationRows / targetRows
          : null,
      warnings: ['junction-reverse-approximation', 'p95-sampling-disabled'],
    };
  }
}
