import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { CommandExplain } from '../../services/CommandExplain';
import { Output } from '../../services/Output';
import { connectionOption, tableIdOption, analyzeOption } from '../shared';

const recordIdsOption = Options.text('record-ids').pipe(
  Options.withDescription('Comma-separated record IDs')
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly recordIds: string;
  readonly analyze: boolean;
}) =>
  Effect.gen(function* () {
    const commandExplain = yield* CommandExplain;
    const output = yield* Output;

    const recordIds = args.recordIds.split(',').map((id) => id.trim());
    const input = { tableId: args.tableId, recordIds, analyze: args.analyze };

    const result = yield* commandExplain
      .explainDelete({
        tableId: args.tableId,
        recordIds,
        analyze: args.analyze,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('explain.delete', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('explain.delete', input, result);
  });

export const explainDelete = Command.make(
  'delete',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    recordIds: recordIdsOption,
    analyze: analyzeOption,
  },
  handler
).pipe(Command.withDescription('Explain DeleteRecords command execution plan'));
