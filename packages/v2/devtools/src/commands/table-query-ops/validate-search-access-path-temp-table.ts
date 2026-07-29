import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { ValidationError } from '../../errors/CliError';
import { Output } from '../../services/Output';
import { TableQueryOps } from '../../services/TableQueryOps';
import { connectionOption, optionToUndefined, parseCsv, tableIdOption } from '../shared';

const fieldIdsOption = Options.text('field-ids').pipe(Options.optional);
const providerOption = Options.choice('provider', ['auto', 'pg_bigm', 'pg_trgm']).pipe(
  Options.withDefault('auto' as const)
);
const probeSourceOption = Options.choice('probe-source', [
  'manual',
  'field_value',
  'select_option',
  'observed_search',
]).pipe(Options.withDefault('manual' as const));
const sampleSearchOption = Options.text('sample-search').pipe(Options.optional);
const sampleSearchesOption = Options.text('sample-searches').pipe(Options.optional);
const queryLimitOption = Options.integer('query-limit').pipe(
  Options.withDefault(1_000),
  Options.withDescription('Page size used while collecting every matching record ID')
);
const rowLimitOption = Options.integer('row-limit').pipe(Options.withDefault(10_000));
const repetitionsOption = Options.integer('repetitions').pipe(
  Options.withDefault(5),
  Options.withDescription('Repeated repository query runs per legacy/optimized path')
);
const allowFullCopyOption = Options.boolean('allow-full-copy').pipe(Options.withDefault(false));
const keepTempTableOption = Options.boolean('keep-temp-table').pipe(Options.withDefault(false));
const noEnsureSchemaOption = Options.boolean('no-ensure-schema').pipe(Options.withDefault(false));

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly fieldIds: Option.Option<string>;
  readonly provider: 'auto' | 'pg_bigm' | 'pg_trgm';
  readonly probeSource: 'manual' | 'field_value' | 'select_option' | 'observed_search';
  readonly sampleSearch: Option.Option<string>;
  readonly sampleSearches: Option.Option<string>;
  readonly queryLimit: number;
  readonly rowLimit: number;
  readonly repetitions: number;
  readonly allowFullCopy: boolean;
  readonly keepTempTable: boolean;
  readonly noEnsureSchema: boolean;
}) =>
  Effect.gen(function* () {
    const tableQueryOps = yield* TableQueryOps;
    const output = yield* Output;
    if (args.rowLimit === 0 && !args.allowFullCopy) {
      return yield* Effect.fail(
        new ValidationError({
          message: '--row-limit 0 requires --allow-full-copy',
          field: 'allow-full-copy',
        })
      );
    }
    if (args.rowLimit < 0 || args.queryLimit <= 0 || args.repetitions <= 0) {
      return yield* Effect.fail(
        new ValidationError({
          message:
            '--row-limit must be non-negative; --query-limit and --repetitions must be positive',
          field: 'validation-limits',
        })
      );
    }
    const firstProbe = optionToUndefined(args.sampleSearch);
    const sampleSearches = [
      ...(firstProbe ? [firstProbe] : []),
      ...parseCsv(optionToUndefined(args.sampleSearches)),
    ];
    const input = {
      connection: optionToUndefined(args.connection),
      tableId: args.tableId,
      fieldIds: parseCsv(optionToUndefined(args.fieldIds)),
      provider: args.provider,
      probeSource: args.probeSource,
      sampleSearches,
      queryLimit: args.queryLimit,
      rowLimit: args.rowLimit,
      repetitions: args.repetitions,
      keepTempTable: args.keepTempTable,
      ensureSchema: !args.noEnsureSchema,
    };
    const outputInput = {
      ...input,
      connection: input.connection ? '<redacted>' : undefined,
      sampleSearches: undefined,
      sampleSearchCount: sampleSearches.length,
      sampleSearchLengthBuckets: sampleSearches.map((probe) =>
        probe.length < 3 ? 'short' : probe.length < 30 ? 'medium' : 'long'
      ),
    };
    const result = yield* tableQueryOps.validateSearchAccessPathTempTable(input).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error(
            'table-query-ops.validate-search-access-path-temp-table',
            outputInput,
            error
          );
          return yield* Effect.fail(error);
        })
      )
    );
    yield* output.success(
      'table-query-ops.validate-search-access-path-temp-table',
      outputInput,
      result
    );
  });

export const tableQueryOpsValidateSearchAccessPathTempTable = Command.make(
  'validate-search-access-path-temp-table',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    fieldIds: fieldIdsOption,
    provider: providerOption,
    probeSource: probeSourceOption,
    sampleSearch: sampleSearchOption,
    sampleSearches: sampleSearchesOption,
    queryLimit: queryLimitOption,
    rowLimit: rowLimitOption,
    repetitions: repetitionsOption,
    allowFullCopy: allowFullCopyOption,
    keepTempTable: keepTempTableOption,
    noEnsureSchema: noEnsureSchemaOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Build a real generated text column and provider GIN on a temporary table, then compare v2 repository results and timings'
  )
);
