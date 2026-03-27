import { Command } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { ValidationError } from '../../errors/CliError';
import { DebugData } from '../../services/DebugData';
import { Output } from '../../services/Output';
import {
  baseIdOptionalOption,
  connectionOption,
  optionToUndefined,
  spaceIdOptionalOption,
} from '../shared';

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly spaceId: Option.Option<string>;
  readonly baseId: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const debugData = yield* DebugData;
    const output = yield* Output;

    const spaceId = optionToUndefined(args.spaceId);
    const baseId = optionToUndefined(args.baseId);
    const input = {
      ...(spaceId ? { spaceId } : {}),
      ...(baseId ? { baseId } : {}),
    };

    if (!spaceId && !baseId) {
      const error = new ValidationError({
        message: 'Provide --space-id or --base-id.',
        field: 'space-id',
      });
      yield* output.error('underlying.canary-space', input, error);
      return yield* Effect.fail(error);
    }

    if (spaceId && baseId) {
      const error = new ValidationError({
        message: 'Use either --space-id or --base-id, not both.',
        field: 'space-id',
      });
      yield* output.error('underlying.canary-space', input, error);
      return yield* Effect.fail(error);
    }

    const result = yield* debugData.checkCanarySpace({ spaceId, baseId }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('underlying.canary-space', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    if (!result) {
      yield* output.empty(
        'underlying.canary-space',
        input,
        `Base "${baseId}" not found. Check if the base ID is correct.`
      );
      return;
    }

    yield* output.success('underlying.canary-space', input, result);
  });

export const underlyingCanarySpace = Command.make(
  'canary-space',
  {
    connection: connectionOption,
    spaceId: spaceIdOptionalOption,
    baseId: baseIdOptionalOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Check whether a space is in canary, using canaryConfig plus ENABLE_CANARY_FEATURE/FORCE_V2_ALL'
  )
);
