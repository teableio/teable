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

const leaseIdOptionalOption = Options.text('lease-id').pipe(
  Options.withDescription('Pause lease ID returned by computed pause/pauses'),
  Options.optional
);

const forceOption = Options.boolean('force').pipe(
  Options.withDefault(false),
  Options.withDescription('Required for legacy scope-wide resume')
);

const actorOption = Options.text('actor').pipe(
  Options.withDefault('devtools-computed-resume'),
  Options.withDescription('Actor tag recorded on the released pause lease')
);

const releaseReasonOption = Options.text('release-reason').pipe(
  Options.withDescription('Optional reason for releasing the pause lease'),
  Options.optional
);

type ScopeSelection = {
  scopeType: 'space' | 'base' | 'table';
  scopeId: string;
};

const resolveScope = (args: {
  readonly leaseId: Option.Option<string>;
  readonly spaceId: Option.Option<string>;
  readonly baseId: Option.Option<string>;
  readonly tableId: Option.Option<string>;
  readonly force: boolean;
  readonly actor: string;
  readonly releaseReason: Option.Option<string>;
}): Effect.Effect<
  | { leaseId: string; actor: string; releaseReason?: string }
  | (ScopeSelection & { actor: string; releaseReason?: string }),
  ValidationError
> =>
  Effect.try({
    try: () => {
      const leaseId = optionToUndefined(args.leaseId);
      const spaceId = optionToUndefined(args.spaceId);
      const baseId = optionToUndefined(args.baseId);
      const tableId = optionToUndefined(args.tableId);
      const releaseReason = optionToUndefined(args.releaseReason);
      const scopes: ScopeSelection[] = [
        ...(spaceId ? [{ scopeType: 'space' as const, scopeId: spaceId }] : []),
        ...(baseId ? [{ scopeType: 'base' as const, scopeId: baseId }] : []),
        ...(tableId ? [{ scopeType: 'table' as const, scopeId: tableId }] : []),
      ];

      if (leaseId && scopes.length > 0) {
        throw new ValidationError({
          message:
            '--lease-id and scope selectors are mutually exclusive. Drop the scope selector to release one lease, or drop --lease-id for a scope-wide resume.',
          field: 'scope',
        });
      }
      if (leaseId) {
        if (args.force) {
          throw new ValidationError({
            message:
              '--force only applies to a scope-wide resume; --lease-id already targets exactly one lease. Drop --force.',
            field: 'force',
          });
        }
        return { leaseId, actor: args.actor, releaseReason };
      }
      if (scopes.length === 1) {
        if (!args.force) {
          throw new ValidationError({
            message:
              'Scope-wide resume requires --force; prefer --lease-id for normal recovery (run `computed pauses` to read the current lease id).',
            field: 'force',
          });
        }
        return { ...scopes[0]!, actor: args.actor, releaseReason };
      }
      throw new ValidationError({
        message:
          'Provide --lease-id, or provide exactly one scope with --force: --space-id, --base-id, or --table-id.',
        field: 'scope',
      });
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
  readonly leaseId: Option.Option<string>;
  readonly spaceId: Option.Option<string>;
  readonly baseId: Option.Option<string>;
  readonly tableId: Option.Option<string>;
  readonly force: boolean;
  readonly actor: string;
  readonly releaseReason: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const computedTaskControl = yield* ComputedTaskControl;
    const output = yield* Output;
    const rawInput = {
      connection: optionToUndefined(args.connection),
      leaseId: optionToUndefined(args.leaseId),
      spaceId: optionToUndefined(args.spaceId),
      baseId: optionToUndefined(args.baseId),
      tableId: optionToUndefined(args.tableId),
      force: args.force,
      actor: args.actor,
      releaseReason: optionToUndefined(args.releaseReason),
    };
    const target = yield* resolveScope(args);

    const input = {
      connection: rawInput.connection,
      ...target,
    };

    const result = yield* computedTaskControl.resumeScope(target);
    yield* output.success('computed.resume', input, result);
  }).pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        const output = yield* Output;
        const rawInput = {
          connection: optionToUndefined(args.connection),
          leaseId: optionToUndefined(args.leaseId),
          spaceId: optionToUndefined(args.spaceId),
          baseId: optionToUndefined(args.baseId),
          tableId: optionToUndefined(args.tableId),
          force: args.force,
          actor: args.actor,
          releaseReason: optionToUndefined(args.releaseReason),
        };
        yield* output.error('computed.resume', rawInput, error);
        return yield* Effect.fail(error);
      })
    )
  );

export const computedResume = Command.make(
  'resume',
  {
    connection: connectionOption,
    leaseId: leaseIdOptionalOption,
    spaceId: spaceIdOptionalOption,
    baseId: baseIdOptionalOption,
    tableId: tableIdOptionalOption,
    force: forceOption,
    actor: actorOption,
    releaseReason: releaseReasonOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Release one pause with --lease-id; legacy scope-wide resume requires an explicit --force'
  )
);
