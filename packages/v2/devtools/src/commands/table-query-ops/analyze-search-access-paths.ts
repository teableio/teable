import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { Output } from '../../services/Output';
import { TableQueryOps } from '../../services/TableQueryOps';
import {
  baseIdOptionalOption,
  connectionOption,
  limitOption,
  optionToUndefined,
  parseCsv,
  spaceIdOptionalOption,
  tableIdOptionalOption,
} from '../shared';
import { redactSearchVectorOutput } from './redact-search-vector-output';

const fieldIdsOption = Options.text('field-ids').pipe(
  Options.withDescription('Comma-separated field IDs; defaults to all searchable fields'),
  Options.optional
);

const providerOption = Options.choice('provider', ['auto', 'pg_bigm', 'pg_trgm']).pipe(
  Options.withDefault('auto' as const),
  Options.withDescription('Substring GIN provider; auto prefers a ready pg_bigm, then pg_trgm')
);

const probeSourceOption = Options.choice('probe-source', [
  'manual',
  'field_value',
  'select_option',
  'observed_search',
]).pipe(
  Options.withDefault('manual' as const),
  Options.withDescription('Business source of the ephemeral search probe')
);

const sampleSearchOption = Options.text('sample-search').pipe(
  Options.withDescription('Ephemeral substring probe used for EXPLAIN; never persisted'),
  Options.optional
);

const maxRecommendationsOption = Options.integer('max-recommendations').pipe(
  Options.withDefault(5),
  Options.withDescription('Maximum search access-path recommendations')
);

const sampleResultLimitOption = Options.integer('sample-result-limit').pipe(
  Options.withDefault(3),
  Options.withDescription('Maximum result previews in advisor semantics evidence')
);

const noEnsureSchemaOption = Options.boolean('no-ensure-schema').pipe(
  Options.withDefault(false),
  Options.withDescription('Do not ensure Table Query Ops metadata schema')
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly spaceId: Option.Option<string>;
  readonly baseId: Option.Option<string>;
  readonly tableId: Option.Option<string>;
  readonly fieldIds: Option.Option<string>;
  readonly provider: 'auto' | 'pg_bigm' | 'pg_trgm';
  readonly probeSource: 'manual' | 'field_value' | 'select_option' | 'observed_search';
  readonly sampleSearch: Option.Option<string>;
  readonly limit: number;
  readonly maxRecommendations: number;
  readonly sampleResultLimit: number;
  readonly noEnsureSchema: boolean;
}) =>
  Effect.gen(function* () {
    const tableQueryOps = yield* TableQueryOps;
    const output = yield* Output;
    const input = {
      connection: optionToUndefined(args.connection),
      spaceId: optionToUndefined(args.spaceId),
      baseId: optionToUndefined(args.baseId),
      tableId: optionToUndefined(args.tableId),
      fieldIds: parseCsv(optionToUndefined(args.fieldIds)),
      provider: args.provider,
      probeSource: args.probeSource,
      sampleSearch: optionToUndefined(args.sampleSearch),
      limit: args.limit,
      maxRecommendations: args.maxRecommendations,
      sampleResultLimit: args.sampleResultLimit,
      ensureSchema: !args.noEnsureSchema,
    };
    const { connection: _connection, sampleSearch: _sampleSearch, ...safeInput } = input;
    const outputInput = {
      ...safeInput,
      ...(input.connection ? { connection: '<redacted>' } : {}),
      searchProbeLengthBucket: lengthBucket(input.sampleSearch),
    };
    const result = yield* tableQueryOps.analyzeSearchAccessPaths(input).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('table-query-ops.analyze-search-access-paths', outputInput, error);
          return yield* Effect.fail(error);
        })
      )
    );
    yield* output.success(
      'table-query-ops.analyze-search-access-paths',
      outputInput,
      redactSearchVectorOutput(result)
    );
  });

const lengthBucket = (value?: string) => {
  const length = value?.trim().length ?? 0;
  return length === 0 ? 'none' : length < 3 ? 'short' : length < 30 ? 'medium' : 'long';
};

export const tableQueryOpsAnalyzeSearchAccessPaths = Command.make(
  'analyze-search-access-paths',
  {
    connection: connectionOption,
    spaceId: spaceIdOptionalOption,
    baseId: baseIdOptionalOption,
    tableId: tableIdOptionalOption,
    fieldIds: fieldIdsOption,
    provider: providerOption,
    probeSource: probeSourceOption,
    sampleSearch: sampleSearchOption,
    limit: limitOption,
    maxRecommendations: maxRecommendationsOption,
    sampleResultLimit: sampleResultLimitOption,
    noEnsureSchema: noEnsureSchemaOption,
  },
  handler
).pipe(Command.withDescription('Analyze substring generated-text GIN access paths'));
