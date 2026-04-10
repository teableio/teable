import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { ComputedTaskControl } from '../../services/ComputedTaskControl';
import { Output } from '../../services/Output';
import { connectionOption, optionToUndefined } from '../shared';

const includeExpiredOption = Options.boolean('include-expired').pipe(
  Options.withDefault(false),
  Options.withDescription('Include rows whose resumeAt has already passed')
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly includeExpired: boolean;
}) =>
  Effect.gen(function* () {
    const computedTaskControl = yield* ComputedTaskControl;
    const output = yield* Output;

    const input = {
      connection: optionToUndefined(args.connection),
      includeExpired: args.includeExpired,
    };

    const result = yield* computedTaskControl
      .listPauseScopes({ activeOnly: !args.includeExpired })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('computed.pauses', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('computed.pauses', input, result);
  });

export const computedPauses = Command.make(
  'pauses',
  {
    connection: connectionOption,
    includeExpired: includeExpiredOption,
  },
  handler
).pipe(Command.withDescription('List computed pause scopes and their effective status'));
