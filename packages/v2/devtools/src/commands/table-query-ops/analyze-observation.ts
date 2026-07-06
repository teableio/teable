import { readFile } from 'node:fs/promises';
import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { Output } from '../../services/Output';
import { TableQueryOps } from '../../services/TableQueryOps';
import { connectionOption, optionToUndefined } from '../shared';

const observationJsonOption = Options.text('observation-json').pipe(
  Options.withDescription('JSON TableQueryObservationWindow draft'),
  Options.optional
);

const observationFileOption = Options.text('observation-file').pipe(
  Options.withDescription('Path to a JSON TableQueryObservationWindow draft'),
  Options.optional
);

const noRecordOption = Options.boolean('no-record').pipe(
  Options.withDefault(false),
  Options.withDescription('Analyze without recording the observation window')
);

const noEnsureSchemaOption = Options.boolean('no-ensure-schema').pipe(
  Options.withDefault(false),
  Options.withDescription('Do not create Table Query Ops metadata tables before analysis')
);

const readObservation = async (
  observationJson: string | undefined,
  observationFile: string | undefined
): Promise<unknown> => {
  if (observationJson && observationFile) {
    throw new Error('Use only one of --observation-json or --observation-file');
  }
  const content =
    observationJson ?? (observationFile ? await readFile(observationFile, 'utf8') : undefined);
  if (!content) {
    throw new Error('Missing --observation-json or --observation-file');
  }
  return JSON.parse(content) as unknown;
};

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly observationJson: Option.Option<string>;
  readonly observationFile: Option.Option<string>;
  readonly noRecord: boolean;
  readonly noEnsureSchema: boolean;
}) =>
  Effect.gen(function* () {
    const tableQueryOps = yield* TableQueryOps;
    const output = yield* Output;
    const observationJson = optionToUndefined(args.observationJson);
    const observationFile = optionToUndefined(args.observationFile);
    const input = {
      connection: optionToUndefined(args.connection),
      ...(observationJson ? { observationJson: '<inline-json>' } : {}),
      ...(observationFile ? { observationFile } : {}),
      recordObservation: !args.noRecord,
      ensureSchema: !args.noEnsureSchema,
    };

    const observation = yield* Effect.tryPromise({
      try: () => readObservation(observationJson, observationFile),
      catch: (error) => error,
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('table-query-ops.analyze-observation', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    const result = yield* tableQueryOps
      .analyzeObservation({
        observation,
        recordObservation: !args.noRecord,
        ensureSchema: !args.noEnsureSchema,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('table-query-ops.analyze-observation', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('table-query-ops.analyze-observation', input, result);
  });

export const tableQueryOpsAnalyzeObservation = Command.make(
  'analyze-observation',
  {
    connection: connectionOption,
    observationJson: observationJsonOption,
    observationFile: observationFileOption,
    noRecord: noRecordOption,
    noEnsureSchema: noEnsureSchemaOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Record and analyze a redacted Table Query Ops observation draft from external evidence'
  )
);
