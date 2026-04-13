import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { ValidationError } from '../../errors/CliError';
import { ComputedTaskControl } from '../../services/ComputedTaskControl';
import { Output } from '../../services/Output';
import {
  baseIdOptionalOption,
  connectionOption,
  optionToUndefined,
  spaceIdOptionalOption,
} from '../shared';

const tableIdOptionalOption = Options.text('table-id').pipe(
  Options.withDescription('Table ID'),
  Options.optional
);

const reasonOption = Options.text('reason').pipe(
  Options.withDescription('Optional reason for the pause'),
  Options.optional
);

const resumeAtOption = Options.text('resume-at').pipe(
  Options.withDescription('Optional ISO-8601 time to auto-expire the pause'),
  Options.optional
);

const actorOption = Options.text('actor').pipe(
  Options.withDefault('devtools-computed-pause'),
  Options.withDescription('Actor tag recorded on the pause scope row')
);

type ScopeSelection = {
  scopeType: 'space' | 'base' | 'table';
  scopeId: string;
};

const resolveScope = (args: {
  readonly spaceId: Option.Option<string>;
  readonly baseId: Option.Option<string>;
  readonly tableId: Option.Option<string>;
}): Effect.Effect<ScopeSelection, ValidationError> =>
  Effect.try({
    try: () => {
      const spaceId = optionToUndefined(args.spaceId);
      const baseId = optionToUndefined(args.baseId);
      const tableId = optionToUndefined(args.tableId);
      const scopes: ScopeSelection[] = [
        ...(spaceId ? [{ scopeType: 'space' as const, scopeId: spaceId }] : []),
        ...(baseId ? [{ scopeType: 'base' as const, scopeId: baseId }] : []),
        ...(tableId ? [{ scopeType: 'table' as const, scopeId: tableId }] : []),
      ];

      if (scopes.length !== 1) {
        throw new ValidationError({
          message: 'Provide exactly one of --space-id, --base-id, or --table-id.',
          field: 'scope',
        });
      }

      return scopes[0]!;
    },
    catch: (error) =>
      error instanceof ValidationError
        ? error
        : new ValidationError({
            message: 'Failed to resolve computed pause scope',
            field: 'scope',
          }),
  });

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly spaceId: Option.Option<string>;
  readonly baseId: Option.Option<string>;
  readonly tableId: Option.Option<string>;
  readonly reason: Option.Option<string>;
  readonly resumeAt: Option.Option<string>;
  readonly actor: string;
}) =>
  Effect.gen(function* () {
    const computedTaskControl = yield* ComputedTaskControl;
    const output = yield* Output;
    const rawInput = {
      connection: optionToUndefined(args.connection),
      spaceId: optionToUndefined(args.spaceId),
      baseId: optionToUndefined(args.baseId),
      tableId: optionToUndefined(args.tableId),
      reason: optionToUndefined(args.reason),
      resumeAt: optionToUndefined(args.resumeAt),
      actor: args.actor,
    };

    const scope = yield* resolveScope(args);
    const input = {
      connection: rawInput.connection,
      ...scope,
      reason: rawInput.reason,
      resumeAt: rawInput.resumeAt,
      actor: rawInput.actor,
    };

    const result = yield* computedTaskControl.pauseScope(input);
    yield* output.success('computed.pause', input, result);
  }).pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        const output = yield* Output;
        const rawInput = {
          connection: optionToUndefined(args.connection),
          spaceId: optionToUndefined(args.spaceId),
          baseId: optionToUndefined(args.baseId),
          tableId: optionToUndefined(args.tableId),
          reason: optionToUndefined(args.reason),
          resumeAt: optionToUndefined(args.resumeAt),
          actor: args.actor,
        };
        yield* output.error('computed.pause', rawInput, error);
        return yield* Effect.fail(error);
      })
    )
  );

export const computedPause = Command.make(
  'pause',
  {
    connection: connectionOption,
    spaceId: spaceIdOptionalOption,
    baseId: baseIdOptionalOption,
    tableId: tableIdOptionalOption,
    reason: reasonOption,
    resumeAt: resumeAtOption,
    actor: actorOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Pause computed polling claims for a space, base, or table scope until resumed or until --resume-at'
  )
);
