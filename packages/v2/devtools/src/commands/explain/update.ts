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
}) =>
  Effect.gen(function* () {
    const commandExplain = yield* CommandExplain;
    const output = yield* Output;

    const fields = yield* parseFields(args.fields);
    const input = {
      tableId: args.tableId,
      recordId: args.recordId,
      fields,
      analyze: args.analyze,
    };

    const result = yield* commandExplain
      .explainUpdate({
        tableId: args.tableId,
        recordId: args.recordId,
        fields,
        analyze: args.analyze,
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
  },
  handler
).pipe(Command.withDescription('Explain UpdateRecord command execution plan'));
