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
 * Base ID option
 */
export const baseIdOption = Options.text('base-id').pipe(Options.withDescription('Base ID'));

export const baseIdOptionalOption = Options.text('base-id').pipe(
  Options.withDescription('Base ID'),
  Options.optional
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
