import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { Output } from '../../services/Output';
import { TableQueryOps } from '../../services/TableQueryOps';
import { connectionOption, optionToUndefined, tableIdOption } from '../shared';
import { redactSearchVectorOutput } from './redact-search-vector-output';

const languageConfigOption = Options.text('language-config').pipe(
  Options.withDefault('simple'),
  Options.withDescription('Postgres text search configuration')
);

const sampleSearchOption = Options.text('sample-search').pipe(
  Options.withDescription(
    'Ephemeral search text used to revalidate the candidate before execution'
  ),
  Options.optional
);

const validationModeOption = Options.choice('validation-mode', ['plan', 'real_ddl']).pipe(
  Options.withDefault('real_ddl' as const),
  Options.withDescription(
    'Execution validation mode: plan uses advisor evidence, real_ddl validates after real DDL'
  )
);

const fieldIdsOption = Options.text('field-ids').pipe(
  Options.withDescription(
    'Optional comma-separated Teable field ids; defaults to all eligible fields'
  ),
  Options.optional
);

const executeOption = Options.boolean('execute').pipe(
  Options.withDefault(false),
  Options.withDescription('Actually execute generated column and GIN index creation')
);

const allowLargeTableRewriteOption = Options.boolean('allow-large-table-rewrite').pipe(
  Options.withDefault(false),
  Options.withDescription('Allow ALTER TABLE ADD GENERATED COLUMN on large tables')
);

const modeOption = Options.choice('mode', ['create', 'rebuild']).pipe(
  Options.withDefault('create' as const),
  Options.withDescription('Idempotently create or rebuild the table search vector')
);

const noEnsureSchemaOption = Options.boolean('no-ensure-schema').pipe(
  Options.withDefault(false),
  Options.withDescription('Do not create Table Query Ops metadata tables before execution')
);

const parseFieldIds = (value: string | undefined) =>
  value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly languageConfig: string;
  readonly sampleSearch: Option.Option<string>;
  readonly validationMode: 'plan' | 'real_ddl';
  readonly fieldIds: Option.Option<string>;
  readonly execute: boolean;
  readonly allowLargeTableRewrite: boolean;
  readonly mode: 'create' | 'rebuild';
  readonly noEnsureSchema: boolean;
}) =>
  Effect.gen(function* () {
    const tableQueryOps = yield* TableQueryOps;
    const output = yield* Output;
    const input = {
      connection: optionToUndefined(args.connection),
      tableId: args.tableId,
      languageConfig: args.languageConfig,
      sampleSearch: optionToUndefined(args.sampleSearch),
      validationMode: args.validationMode,
      fieldIds: parseFieldIds(optionToUndefined(args.fieldIds)),
      execute: args.execute,
      allowLargeTableRewrite: args.allowLargeTableRewrite,
      mode: args.mode,
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

    const result = yield* tableQueryOps.executeSearchVector(input).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('table-query-ops.execute-search-vector', outputInput, error);
          return yield* Effect.fail(error);
        })
      )
    );

    yield* output.success(
      'table-query-ops.execute-search-vector',
      outputInput,
      redactSearchVectorOutput(result)
    );
  });

export const tableQueryOpsExecuteSearchVector = Command.make(
  'execute-search-vector',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    languageConfig: languageConfigOption,
    sampleSearch: sampleSearchOption,
    validationMode: validationModeOption,
    fieldIds: fieldIdsOption,
    execute: executeOption,
    allowLargeTableRewrite: allowLargeTableRewriteOption,
    mode: modeOption,
    noEnsureSchema: noEnsureSchemaOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Deprecated alias for execute-search-access-path; execution still requires real-DDL validation'
  )
);
