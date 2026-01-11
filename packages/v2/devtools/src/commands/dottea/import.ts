import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';

import { ValidationError } from '../../errors/CliError';
import { DotTeaImporter } from '../../services/DotTeaImporter';
import { Output } from '../../services/Output';
import { baseIdOptionalOption, connectionOption, optionToUndefined } from '../shared';

const pathOption = Options.text('path').pipe(
  Options.withDescription('Path to the .tea file'),
  Options.optional
);

const stdinOption = Options.boolean('stdin').pipe(
  Options.withDefault(false),
  Options.withDescription('Read .tea data from stdin')
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly baseId: Option.Option<string>;
  readonly path: Option.Option<string>;
  readonly stdin: boolean;
}) =>
  Effect.gen(function* () {
    const importer = yield* DotTeaImporter;
    const output = yield* Output;

    const baseId = optionToUndefined(args.baseId);
    const path = optionToUndefined(args.path);

    if (!args.stdin && !path) {
      return yield* Effect.fail(
        new ValidationError({ message: 'Provide --path or use --stdin', field: 'path' })
      );
    }

    if (args.stdin && path) {
      return yield* Effect.fail(
        new ValidationError({ message: 'Use either --stdin or --path, not both', field: 'stdin' })
      );
    }

    const source = args.stdin
      ? { type: 'stream' as const, stream: process.stdin }
      : { type: 'path' as const, path: path as string };

    const input = {
      baseId,
      source,
    };

    const result = yield* importer.importStructure(input).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('dottea.import', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    yield* output.success('dottea.import', input, result);
  });

export const dotteaImport = Command.make(
  'import',
  {
    connection: connectionOption,
    baseId: baseIdOptionalOption,
    path: pathOption,
    stdin: stdinOption,
  },
  handler
).pipe(Command.withDescription('Import .tea structure into an existing base'));
