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
  Options.withDescription('Ephemeral search text used for EXPLAIN only; never persisted'),
  Options.optional
);

const maxRecommendationsOption = Options.integer('max-recommendations').pipe(
  Options.withDefault(5),
  Options.withDescription('Maximum number of search vector recommendations')
);

const sampleResultLimitOption = Options.integer('sample-result-limit').pipe(
  Options.withDefault(3),
  Options.withDescription('Maximum sample records per search semantics strategy')
);

const noEnsureSchemaOption = Options.boolean('no-ensure-schema').pipe(
  Options.withDefault(false),
  Options.withDescription('Do not create Table Query Ops metadata tables before analysis')
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly spaceId: Option.Option<string>;
  readonly baseId: Option.Option<string>;
  readonly tableId: Option.Option<string>;
  readonly fieldIds: Option.Option<string>;
  readonly languageConfig: string;
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
      languageConfig: args.languageConfig,
      sampleSearch: optionToUndefined(args.sampleSearch),
      limit: args.limit,
      maxRecommendations: args.maxRecommendations,
      sampleResultLimit: args.sampleResultLimit,
      ensureSchema: !args.noEnsureSchema,
    };
    const { connection: _connection, sampleSearch: _sampleSearch, ...redactedInput } = input;
    const searchProbeLength = input.sampleSearch?.trim().length ?? 0;
    const outputInput = {
      ...redactedInput,
      ...(input.connection ? { connection: '<redacted>' } : {}),
      searchProbeLengthBucket:
        searchProbeLength === 0
          ? 'none'
          : searchProbeLength < 3
            ? 'short'
            : searchProbeLength < 30
              ? 'medium'
              : 'long',
    };

    const result = yield* tableQueryOps.analyzeSearchVectors(input).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('table-query-ops.analyze-search-vectors', outputInput, error);
          return yield* Effect.fail(error);
        })
      )
    );

    yield* output.success(
      'table-query-ops.analyze-search-vectors',
      outputInput,
      redactSearchVectorOutput(result)
    );
  });

export const tableQueryOpsAnalyzeSearchVectors = Command.make(
  'analyze-search-vectors',
  {
    connection: connectionOption,
    spaceId: spaceIdOptionalOption,
    baseId: baseIdOptionalOption,
    tableId: tableIdOptionalOption,
    fieldIds: fieldIdsOption,
    languageConfig: languageConfigOption,
    sampleSearch: sampleSearchOption,
    limit: limitOption,
    maxRecommendations: maxRecommendationsOption,
    sampleResultLimit: sampleResultLimitOption,
    noEnsureSchema: noEnsureSchemaOption,
  },
  handler
).pipe(Command.withDescription('Analyze generated tsvector search access-path candidates'));
