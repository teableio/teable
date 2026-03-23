import { Command } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { Output } from '../../services/Output';
import { SchemaRepairer } from '../../services/SchemaRepairer';
import {
  connectionOption,
  dryRunOption,
  fieldIdOption,
  ruleIdOption,
  tableIdOption,
} from '../shared';

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly fieldId: string;
  readonly ruleId: string;
  readonly dryRun: boolean;
}) =>
  Effect.gen(function* () {
    const schemaRepairer = yield* SchemaRepairer;
    const output = yield* Output;

    const input = {
      tableId: args.tableId,
      fieldId: args.fieldId,
      ruleId: args.ruleId,
      dryRun: args.dryRun,
    };
    const result = yield* schemaRepairer
      .repairRule(args.tableId, args.fieldId, args.ruleId, { dryRun: args.dryRun })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('schema.repair.rule', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('schema.repair.rule', input, result);
  });

export const schemaRepairRule = Command.make(
  'rule',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    fieldId: fieldIdOption,
    ruleId: ruleIdOption,
    dryRun: dryRunOption,
  },
  handler
).pipe(Command.withDescription('Repair a specific schema rule for a field'));
