import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { ValidationError } from '../../errors/CliError';
import { CommandExplain } from '../../services/CommandExplain';
import { Output } from '../../services/Output';
import { connectionOption, tableIdOption, analyzeOption } from '../shared';

const recordIdOption = Options.text('record-id').pipe(Options.withDescription('Record ID'));

const fieldsOption = Options.text('fields').pipe(
  Options.withDescription('JSON object of field values to update')
);

const noSqlOption = Options.boolean('no-sql').pipe(
  Options.withDefault(false),
  Options.withDescription('Skip generated SQL and SQL EXPLAIN; only show command impact summary')
);

const dumpSqlOption = Options.boolean('dump-sql').pipe(
  Options.withDefault(false),
  Options.withDescription('Include generated SQL without running PostgreSQL EXPLAIN')
);

const formatOption = Options.choice('format', ['json', 'text']).pipe(
  Options.withDefault('json' as const),
  Options.withDescription('SQL EXPLAIN output format')
);

const statementTimeoutMsOption = Options.integer('statement-timeout-ms').pipe(
  Options.withDefault(0),
  Options.withDescription('PostgreSQL statement_timeout for SQL EXPLAIN calls, in milliseconds')
);

const parseFields = (json: string): Effect.Effect<Record<string, unknown>, ValidationError> =>
  Effect.try({
    try: () => JSON.parse(json) as Record<string, unknown>,
    catch: () => new ValidationError({ message: 'Invalid JSON in --fields', field: 'fields' }),
  });

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly recordId: string;
  readonly fields: string;
  readonly analyze: boolean;
  readonly noSql: boolean;
  readonly dumpSql: boolean;
  readonly format: 'json' | 'text';
  readonly statementTimeoutMs: number;
}) =>
  Effect.gen(function* () {
    const commandExplain = yield* CommandExplain;
    const output = yield* Output;

    if (args.noSql && args.dumpSql) {
      return yield* Effect.fail(
        new ValidationError({
          message: '--no-sql and --dump-sql cannot be used together',
          field: 'no-sql',
        })
      );
    }

    const fields = yield* parseFields(args.fields);
    const includeSql = !args.noSql;
    const sqlExplainMode = args.dumpSql ? 'dump' : args.format;
    const input = {
      tableId: args.tableId,
      recordId: args.recordId,
      fields,
      analyze: args.analyze,
      includeSql,
      sqlExplainMode,
      statementTimeoutMs: args.statementTimeoutMs,
    };

    const result = yield* commandExplain
      .explainUpdate({
        tableId: args.tableId,
        recordId: args.recordId,
        fields,
        analyze: args.analyze,
        includeSql,
        sqlExplainMode,
        statementTimeoutMs: args.statementTimeoutMs,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('explain.update', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('explain.update', input, result);
  });

export const explainUpdate = Command.make(
  'update',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    recordId: recordIdOption,
    fields: fieldsOption,
    analyze: analyzeOption,
    noSql: noSqlOption,
    dumpSql: dumpSqlOption,
    format: formatOption,
    statementTimeoutMs: statementTimeoutMsOption,
  },
  handler
).pipe(Command.withDescription('Explain UpdateRecord command execution plan'));
