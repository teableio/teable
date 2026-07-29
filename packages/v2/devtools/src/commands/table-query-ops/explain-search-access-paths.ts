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

const fieldIdsOption = Options.text('field-ids').pipe(Options.optional);
const providerOption = Options.choice('provider', ['auto', 'pg_bigm', 'pg_trgm']).pipe(
  Options.withDefault('auto' as const),
  Options.withDescription('Substring GIN provider')
);
const probeSourceOption = Options.choice('probe-source', [
  'manual',
  'field_value',
  'select_option',
  'observed_search',
]).pipe(Options.withDefault('manual' as const));
const sampleSearchOption = Options.text('sample-search').pipe(
  Options.withDescription('Required ephemeral substring probe for before/after EXPLAIN')
);
const maxRecommendationsOption = Options.integer('max-recommendations').pipe(
  Options.withDefault(5)
);
const sampleResultLimitOption = Options.integer('sample-result-limit').pipe(Options.withDefault(3));
const noEnsureSchemaOption = Options.boolean('no-ensure-schema').pipe(Options.withDefault(false));

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly spaceId: Option.Option<string>;
  readonly baseId: Option.Option<string>;
  readonly tableId: Option.Option<string>;
  readonly fieldIds: Option.Option<string>;
  readonly provider: 'auto' | 'pg_bigm' | 'pg_trgm';
  readonly probeSource: 'manual' | 'field_value' | 'select_option' | 'observed_search';
  readonly sampleSearch: string;
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
      sampleSearch: args.sampleSearch,
      limit: args.limit,
      maxRecommendations: args.maxRecommendations,
      sampleResultLimit: args.sampleResultLimit,
      ensureSchema: !args.noEnsureSchema,
    };
    const { connection: _connection, sampleSearch: _sampleSearch, ...safeInput } = input;
    const outputInput = {
      ...safeInput,
      ...(input.connection ? { connection: '<redacted>' } : {}),
      searchProbeLengthBucket:
        input.sampleSearch.trim().length < 3
          ? 'short'
          : input.sampleSearch.trim().length < 30
            ? 'medium'
            : 'long',
    };
    const result = yield* tableQueryOps.explainSearchAccessPaths(input).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('table-query-ops.explain-search-access-paths', outputInput, error);
          return yield* Effect.fail(error);
        })
      )
    );
    yield* output.success(
      'table-query-ops.explain-search-access-paths',
      outputInput,
      redactSearchVectorOutput(result)
    );
  });

export const tableQueryOpsExplainSearchAccessPaths = Command.make(
  'explain-search-access-paths',
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
).pipe(Command.withDescription('Explain substring access paths without installing extensions'));
