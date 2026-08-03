import { Command } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { Output } from '../../services/Output';
import { SchemaRepairer } from '../../services/SchemaRepairer';
import { connectionOption, dryRunOption, tableIdOption } from '../shared';

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly dryRun: boolean;
}) =>
  Effect.gen(function* () {
    const schemaRepairer = yield* SchemaRepairer;
    const output = yield* Output;

    const input = { tableId: args.tableId, dryRun: args.dryRun };
    const result = yield* schemaRepairer.repairTable(args.tableId, { dryRun: args.dryRun }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('schema.repair.table', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    yield* output.success('schema.repair.table', input, result);
  });

export const schemaRepairTable = Command.make(
  'table',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    dryRun: dryRunOption,
  },
  handler
).pipe(Command.withDescription('Repair schema for all rules in a table'));
