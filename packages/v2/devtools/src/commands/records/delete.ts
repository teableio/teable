import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { Output } from '../../services/Output';
import { RecordMutation } from '../../services/RecordMutation';
import { connectionOption, tableIdOption } from '../shared';

const recordIdsOption = Options.text('record-ids').pipe(
  Options.withDescription('Comma-separated record IDs to delete')
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly recordIds: string;
}) =>
  Effect.gen(function* () {
    const recordMutation = yield* RecordMutation;
    const output = yield* Output;

    const recordIds = args.recordIds.split(',').map((id) => id.trim());
    const input = { tableId: args.tableId, recordIds };

    const result = yield* recordMutation
      .deleteRecords({
        tableId: args.tableId,
        recordIds,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('records.delete', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('records.delete', input, result);
  });

export const recordsDelete = Command.make(
  'delete',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    recordIds: recordIdsOption,
  },
  handler
).pipe(Command.withDescription('Delete records via DeleteRecordsCommand'));
