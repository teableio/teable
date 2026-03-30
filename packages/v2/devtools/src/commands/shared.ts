import { Options } from '@effect/cli';
import { Option } from 'effect';

/**
 * Global database connection option
 */
export const connectionOption = Options.text('connection').pipe(
  Options.withAlias('c'),
  Options.withDescription('Database connection string (overrides env)'),
  Options.optional
);

/**
 * Table ID option
 */
export const tableIdOption = Options.text('table-id').pipe(Options.withDescription('Table ID'));

/**
 * Field ID option
 */
export const fieldIdOption = Options.text('field-id').pipe(Options.withDescription('Field ID'));

/**
 * Rule ID option
 */
export const ruleIdOption = Options.text('rule-id').pipe(Options.withDescription('Rule ID'));

/**
 * Base ID option
 */
export const baseIdOption = Options.text('base-id').pipe(Options.withDescription('Base ID'));

export const baseIdOptionalOption = Options.text('base-id').pipe(
  Options.withDescription('Base ID'),
  Options.optional
);

/**
 * Space ID option
 */
export const spaceIdOption = Options.text('space-id').pipe(Options.withDescription('Space ID'));

export const spaceIdOptionalOption = Options.text('space-id').pipe(
  Options.withDescription('Space ID'),
  Options.optional
);

export const baseIdsOption = Options.text('base-ids').pipe(
  Options.withDescription('Comma-separated base IDs'),
  Options.optional
);

export const tableIdsOption = Options.text('table-ids').pipe(
  Options.withDescription('Comma-separated table IDs'),
  Options.optional
);

export const tableMatchOption = Options.choice('table-match', ['seed', 'target', 'any']).pipe(
  Options.withDefault('any' as const),
  Options.withDescription(
    'How table filtering should match tasks: seed table only, direct target tables only, or either'
  )
);

/**
 * Record ID option
 */
export const recordIdOption = Options.text('record-id').pipe(Options.withDescription('Record ID'));

/**
 * Analyze option for EXPLAIN commands
 */
export const analyzeOption = Options.boolean('analyze').pipe(
  Options.withDefault(false),
  Options.withDescription('Run EXPLAIN ANALYZE for actual execution stats')
);

export const dryRunOption = Options.boolean('dry-run').pipe(
  Options.withDefault(false),
  Options.withDescription('Plan the repair without executing database writes')
);

/**
 * Limit option for pagination
 */
export const limitOption = Options.integer('limit').pipe(
  Options.withDefault(100),
  Options.withDescription('Maximum number of records to return (default: 100)')
);

/**
 * Offset option for pagination
 */
export const offsetOption = Options.integer('offset').pipe(
  Options.withDefault(0),
  Options.withDescription('Number of records to skip (default: 0)')
);

export const staleHoursOption = Options.integer('stale-hours').pipe(
  Options.withDefault(1),
  Options.withDescription('Age threshold in hours for stale processing tasks (default: 1)')
);

export const updatedFromOption = Options.text('updated-from').pipe(
  Options.withDescription('Inclusive lower bound for updated_at, ISO-8601'),
  Options.optional
);

export const updatedToOption = Options.text('updated-to').pipe(
  Options.withDescription('Inclusive upper bound for updated_at, ISO-8601'),
  Options.optional
);

export const csvPathOption = Options.text('csv-path').pipe(
  Options.withDescription('Write a selected table output to a local CSV file'),
  Options.optional
);

export const topOption = Options.integer('top').pipe(
  Options.withDefault(20),
  Options.withDescription('Maximum number of grouped rows to return (default: 20)')
);

/**
 * Mode option for record queries
 */
export const modeOption = Options.choice('mode', ['stored', 'computed']).pipe(
  Options.withDefault('stored' as const),
  Options.withDescription(
    'Query mode: stored reads pre-computed values, computed calculates on-the-fly'
  )
);

/**
 * Helper to convert Option<string> to string | undefined
 */
export const optionToUndefined = <T>(opt: Option.Option<T>): T | undefined =>
  Option.getOrUndefined(opt);

export const parseCsv = (value: string | undefined): string[] =>
  value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
