import { Command } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { Output } from '../../services/Output';
import { SchemaRepairer } from '../../services/SchemaRepairer';
import { connectionOption, dryRunOption, fieldIdOption, tableIdOption } from '../shared';

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly fieldId: string;
  readonly dryRun: boolean;
}) =>
  Effect.gen(function* () {
    const schemaRepairer = yield* SchemaRepairer;
    const output = yield* Output;

    const input = { tableId: args.tableId, fieldId: args.fieldId, dryRun: args.dryRun };
    const result = yield* schemaRepairer
      .repairField(args.tableId, args.fieldId, { dryRun: args.dryRun })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('schema.repair.field', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('schema.repair.field', input, result);
  });

export const schemaRepairField = Command.make(
  'field',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    fieldId: fieldIdOption,
    dryRun: dryRunOption,
  },
  handler
).pipe(Command.withDescription('Repair schema for all rules in a field'));
