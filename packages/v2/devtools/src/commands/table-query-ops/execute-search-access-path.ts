import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { Output } from '../../services/Output';
import { TableQueryOps } from '../../services/TableQueryOps';
import { connectionOption, optionToUndefined, parseCsv, tableIdOption } from '../shared';
import { redactSearchVectorOutput } from './redact-search-vector-output';

const providerOption = Options.choice('provider', ['auto', 'pg_bigm', 'pg_trgm']).pipe(
  Options.withDefault('auto' as const)
);
const probeSourceOption = Options.choice('probe-source', [
  'manual',
  'field_value',
  'select_option',
  'observed_search',
]).pipe(Options.withDefault('manual' as const));
const sampleSearchOption = Options.text('sample-search').pipe(
  Options.withDescription('Ephemeral probe required by --execute real-DDL validation'),
  Options.optional
);
const fieldIdsOption = Options.text('field-ids').pipe(Options.optional);
const executeOption = Options.boolean('execute').pipe(
  Options.withDefault(false),
  Options.withDescription('Run DDL; omitted performs a read-only dry run')
);
const allowLargeTableRewriteOption = Options.boolean('allow-large-table-rewrite').pipe(
  Options.withDefault(false)
);
const modeOption = Options.choice('mode', ['create', 'rebuild']).pipe(
  Options.withDefault('create' as const)
);
const noEnsureSchemaOption = Options.boolean('no-ensure-schema').pipe(Options.withDefault(false));

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly provider: 'auto' | 'pg_bigm' | 'pg_trgm';
  readonly probeSource: 'manual' | 'field_value' | 'select_option' | 'observed_search';
  readonly sampleSearch: Option.Option<string>;
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
      provider: args.provider,
      probeSource: args.probeSource,
      sampleSearch: optionToUndefined(args.sampleSearch),
      validationMode: 'real_ddl' as const,
      fieldIds: parseCsv(optionToUndefined(args.fieldIds)),
      execute: args.execute,
      allowLargeTableRewrite: args.allowLargeTableRewrite,
      mode: args.mode,
      ensureSchema: !args.noEnsureSchema,
    };
    const { connection: _connection, sampleSearch: _sampleSearch, ...safeInput } = input;
    const outputInput = {
      ...safeInput,
      ...(input.connection ? { connection: '<redacted>' } : {}),
      searchProbeLength: input.sampleSearch?.trim().length ?? 0,
    };
    const result = yield* tableQueryOps.executeSearchAccessPath(input).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('table-query-ops.execute-search-access-path', outputInput, error);
          return yield* Effect.fail(error);
        })
      )
    );
    yield* output.success(
      'table-query-ops.execute-search-access-path',
      outputInput,
      redactSearchVectorOutput(result)
    );
  });

export const tableQueryOpsExecuteSearchAccessPath = Command.make(
  'execute-search-access-path',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    provider: providerOption,
    probeSource: probeSourceOption,
    sampleSearch: sampleSearchOption,
    fieldIds: fieldIdsOption,
    execute: executeOption,
    allowLargeTableRewrite: allowLargeTableRewriteOption,
    mode: modeOption,
    noEnsureSchema: noEnsureSchemaOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Dry-run or execute a substring access path with mandatory real-DDL validation'
  )
);
