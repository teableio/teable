import { Command, Options } from '@effect/cli';
import { Effect, Option } from 'effect';
import { DebugData } from '../services/DebugData';
import { Output } from '../services/Output';
import { connectionOption, fieldIdOption } from './shared';

const directionOption = Options.choice('direction', ['up', 'down', 'both']).pipe(
  Options.withDefault('both' as const),
  Options.withDescription('Traversal direction: up = who depends on me, down = what I depend on')
);

const levelOption = Options.integer('level').pipe(
  Options.withDescription('Max traversal depth (default: unlimited)'),
  Options.optional
);

const sameTableOption = Options.boolean('same-table').pipe(
  Options.withDefault(false),
  Options.withDescription('Only traverse same-table relations')
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly fieldId: string;
  readonly direction: 'up' | 'down' | 'both';
  readonly level: Option.Option<number>;
  readonly sameTable: boolean;
}) =>
  Effect.gen(function* () {
    const debugData = yield* DebugData;
    const output = yield* Output;

    const maxDepth = Option.getOrNull(args.level);
    const input = {
      fieldId: args.fieldId,
      direction: args.direction,
      maxDepth,
      sameTableOnly: args.sameTable,
    };

    const result = yield* debugData
      .getFieldRelationReport(args.fieldId, {
        direction: args.direction,
        maxDepth,
        sameTableOnly: args.sameTable,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            const errorMsg = error.message;
            if (errorMsg.includes('not found') || errorMsg.includes('Not found')) {
              yield* output.empty(
                'relations',
                input,
                `Field "${args.fieldId}" not found. Check if the field ID is correct.`
              );
            } else {
              yield* output.error('relations', input, error);
            }
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('relations', input, result);
  });

export const relations = Command.make(
  'relations',
  {
    connection: connectionOption,
    fieldId: fieldIdOption,
    direction: directionOption,
    level: levelOption,
    sameTable: sameTableOption,
  },
  handler
).pipe(Command.withDescription('Query field dependency graph'));
