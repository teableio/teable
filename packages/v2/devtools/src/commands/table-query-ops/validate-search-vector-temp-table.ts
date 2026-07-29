import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { ValidationError } from '../../errors/CliError';
import { Output } from '../../services/Output';
import { TableQueryOps } from '../../services/TableQueryOps';
import { connectionOption, optionToUndefined, parseCsv, tableIdOption } from '../shared';

const searchProbeLengthBucket = (search: string): 'none' | 'short' | 'medium' | 'long' => {
  const length = search.trim().length;
  if (length === 0) return 'none';
  if (length < 3) return 'short';
  if (length < 30) return 'medium';
  return 'long';
};

const fieldIdsOption = Options.text('field-ids').pipe(
  Options.withDescription(
    'Comma-separated field IDs to include; defaults to all searchable fields'
  ),
  Options.optional
);

const languageConfigOption = Options.text('language-config').pipe(
  Options.withDefault('simple'),
  Options.withDescription('Postgres text search configuration (default: simple)')
);

const sampleSearchOption = Options.text('sample-search').pipe(
  Options.withDescription('Single ephemeral search text for validation'),
  Options.optional
);

const sampleSearchesOption = Options.text('sample-searches').pipe(
  Options.withDescription('Comma-separated ephemeral search texts for validation'),
  Options.optional
);

const queryLimitOption = Options.integer('query-limit').pipe(
  Options.withDefault(20),
  Options.withDescription('Record query limit for each path')
);

const rowLimitOption = Options.integer('row-limit').pipe(
  Options.withDefault(10_000),
  Options.withDescription(
    'Rows copied into the validation table; pass 0 only for an approved full copy'
  )
);

const allowFullCopyOption = Options.boolean('allow-full-copy').pipe(
  Options.withDefault(false),
  Options.withDescription('Explicitly approve copying every source row when --row-limit 0 is used')
);

const keepTempTableOption = Options.boolean('keep-temp-table').pipe(
  Options.withDefault(false),
  Options.withDescription('Keep the validation table for manual inspection')
);

const noEnsureSchemaOption = Options.boolean('no-ensure-schema').pipe(
  Options.withDefault(false),
  Options.withDescription('Do not create Table Query Ops metadata tables before validation')
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly fieldIds: Option.Option<string>;
  readonly languageConfig: string;
  readonly sampleSearch: Option.Option<string>;
  readonly sampleSearches: Option.Option<string>;
  readonly queryLimit: number;
  readonly rowLimit: number;
  readonly allowFullCopy: boolean;
  readonly keepTempTable: boolean;
  readonly noEnsureSchema: boolean;
}) =>
  Effect.gen(function* () {
    const tableQueryOps = yield* TableQueryOps;
    const output = yield* Output;
    const sampleSearch = optionToUndefined(args.sampleSearch);
    const sampleSearches = [
      ...(sampleSearch ? [sampleSearch] : []),
      ...parseCsv(optionToUndefined(args.sampleSearches)),
    ];
    if (args.rowLimit === 0 && !args.allowFullCopy) {
      return yield* Effect.fail(
        new ValidationError({
          message: '--row-limit 0 requires --allow-full-copy',
          field: 'allow-full-copy',
        })
      );
    }
    if (args.rowLimit < 0) {
      return yield* Effect.fail(
        new ValidationError({
          message: '--row-limit must be 0 or a positive integer',
          field: 'row-limit',
        })
      );
    }
    const input = {
      connection: optionToUndefined(args.connection),
      tableId: args.tableId,
      fieldIds: parseCsv(optionToUndefined(args.fieldIds)),
      languageConfig: args.languageConfig,
      sampleSearches,
      queryLimit: args.queryLimit,
      rowLimit: args.rowLimit,
      keepTempTable: args.keepTempTable,
      ensureSchema: !args.noEnsureSchema,
    };
    const { sampleSearches: _sampleSearches, ...inputWithoutSearches } = input;
    const outputInput = {
      ...inputWithoutSearches,
      ...(inputWithoutSearches.connection ? { connection: '<redacted>' } : {}),
      sampleSearchCount: sampleSearches.length,
      sampleSearchLengthBuckets: sampleSearches.map(searchProbeLengthBucket),
    };

    const result = yield* tableQueryOps.validateSearchVectorTempTable(input).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error(
            'table-query-ops.validate-search-vector-temp-table',
            outputInput,
            error
          );
          return yield* Effect.fail(error);
        })
      )
    );

    yield* output.success('table-query-ops.validate-search-vector-temp-table', outputInput, result);
  });

export const tableQueryOpsValidateSearchVectorTempTable = Command.make(
  'validate-search-vector-temp-table',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    fieldIds: fieldIdsOption,
    languageConfig: languageConfigOption,
    sampleSearch: sampleSearchOption,
    sampleSearches: sampleSearchesOption,
    queryLimit: queryLimitOption,
    rowLimit: rowLimitOption,
    allowFullCopy: allowFullCopyOption,
    keepTempTable: keepTempTableOption,
    noEnsureSchema: noEnsureSchemaOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Deprecated alias for validate-search-access-path-temp-table; validates substring generated text'
  )
);
