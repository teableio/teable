import { Command } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { DebugData } from '../../services/DebugData';
import { Output } from '../../services/Output';
import { connectionOption, fieldIdOption } from '../shared';

const handler = (args: { readonly connection: Option.Option<string>; readonly fieldId: string }) =>
  Effect.gen(function* () {
    const debugData = yield* DebugData;
    const output = yield* Output;

    const input = { fieldId: args.fieldId };

    const result = yield* debugData.getField(args.fieldId).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('underlying.field', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    if (!result) {
      yield* output.empty(
        'underlying.field',
        input,
        `Field "${args.fieldId}" not found. Check if the field ID is correct.`
      );
      return;
    }

    yield* output.success('underlying.field', input, result);
  });

export const underlyingField = Command.make(
  'field',
  {
    connection: connectionOption,
    fieldId: fieldIdOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Get field metadata from underlying database (includes parsed options/meta JSON)'
  )
);
