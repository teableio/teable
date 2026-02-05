import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { ValidationError } from '../../errors/CliError';
import { Output } from '../../services/Output';
import { RecordMutation } from '../../services/RecordMutation';
import { connectionOption, tableIdOption, recordIdOption } from '../shared';

const fieldsOption = Options.text('fields').pipe(
  Options.withDescription('JSON object of field values to update')
);

const typecastOption = Options.boolean('typecast').pipe(
  Options.withDefault(false),
  Options.withDescription('Enable typecast mode to auto-convert values')
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
  readonly typecast: boolean;
}) =>
  Effect.gen(function* () {
    const recordMutation = yield* RecordMutation;
    const output = yield* Output;

    const fields = yield* parseFields(args.fields);
    const input = {
      tableId: args.tableId,
      recordId: args.recordId,
      fields,
      typecast: args.typecast,
    };

    const result = yield* recordMutation
      .updateRecord({
        tableId: args.tableId,
        recordId: args.recordId,
        fields,
        typecast: args.typecast,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('records.update', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('records.update', input, result);
  });

export const recordsUpdate = Command.make(
  'update',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    recordId: recordIdOption,
    fields: fieldsOption,
    typecast: typecastOption,
  },
  handler
).pipe(Command.withDescription('Update an existing record via UpdateRecordCommand'));
