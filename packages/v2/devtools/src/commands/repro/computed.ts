import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';

import type { ReproTriggerKind } from '../../repro/deadLetter';
import { ComputedRepro } from '../../services/ComputedRepro';
import { Output } from '../../services/Output';
import { connectionOption, optionToUndefined } from '../shared';

const baseIdOption = Options.text('base-id').pipe(
  Options.withDescription('Source base id to export structure from'),
  Options.optional
);

const tableIdOption = Options.text('table-id').pipe(
  Options.withDescription('Seed table id used for trigger derivation'),
  Options.optional
);

const taskIdOption = Options.text('task-id').pipe(
  Options.withDescription('Dead-letter task id (cuo...) read from the source data DB'),
  Options.optional
);

const deadLetterOption = Options.text('dead-letter').pipe(
  Options.withDescription(
    'Dead-letter JSON file (admin page payload or computed_update_dead_letter row)'
  ),
  Options.optional
);

const structureOption = Options.text('structure').pipe(
  Options.withDescription('.tea file or raw structure.json (skips the live export)'),
  Options.optional
);

const rowsOption = Options.text('rows').pipe(
  Options.withDescription(
    'JSON row sample { "<tableId>": [{ "<fieldId>": value }] } used instead of mock rows'
  ),
  Options.optional
);

const emitSpecOption = Options.text('emit-spec').pipe(
  Options.withDescription('Write a vitest *.pglite.spec.ts skeleton to this path'),
  Options.optional
);

const outOption = Options.text('out').pipe(
  Options.withDescription('Artifact directory (default .tmp/repro/computed-<label>)'),
  Options.optional
);

const idMapOption = Options.text('id-map').pipe(
  Options.withDescription('id -> original name map path (default <out>.id-map.json)'),
  Options.optional
);

const seedOption = Options.integer('seed').pipe(
  Options.withDescription('Mock row seed (default 1)'),
  Options.optional
);

const rowsCountOption = Options.integer('rows-count').pipe(
  Options.withDefault(5),
  Options.withDescription('Mock rows per table (default 5)')
);

const noAnonymizeOption = Options.boolean('no-anonymize').pipe(
  Options.withDefault(false),
  Options.withDescription('Keep original display names (local-only artifacts)')
);

const triggerOption = Options.choice('trigger', [
  'record-update',
  'field-update',
  'link-change',
]).pipe(Options.withDescription('Force a trigger kind instead of deriving it'), Options.optional);

const triggerFieldOption = Options.text('trigger-field').pipe(
  Options.withDescription('Declared field id changed by the trigger'),
  Options.optional
);

const faultOption = Options.text('fault').pipe(
  Options.withDescription(
    'Local fault injection: column-type-drift:<declaredFieldId> (verifies failure capture)'
  ),
  Options.optional
);

const triggerJsonOption = Options.text('trigger-json').pipe(
  Options.withDescription(
    'Explicit trigger payload { kind, tableId, fieldIds? , fieldId?, field? } in declared ids'
  ),
  Options.optional
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly baseId: Option.Option<string>;
  readonly tableId: Option.Option<string>;
  readonly taskId: Option.Option<string>;
  readonly deadLetter: Option.Option<string>;
  readonly structure: Option.Option<string>;
  readonly rows: Option.Option<string>;
  readonly emitSpec: Option.Option<string>;
  readonly out: Option.Option<string>;
  readonly idMap: Option.Option<string>;
  readonly seed: Option.Option<number>;
  readonly rowsCount: number;
  readonly noAnonymize: boolean;
  readonly trigger: Option.Option<ReproTriggerKind>;
  readonly triggerField: Option.Option<string>;
  readonly triggerJson: Option.Option<string>;
  readonly fault: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const repro = yield* ComputedRepro;
    const output = yield* Output;

    const input = {
      connection: optionToUndefined(args.connection),
      baseId: optionToUndefined(args.baseId),
      tableId: optionToUndefined(args.tableId),
      taskId: optionToUndefined(args.taskId),
      deadLetter: optionToUndefined(args.deadLetter),
      structure: optionToUndefined(args.structure),
      rows: optionToUndefined(args.rows),
      emitSpec: optionToUndefined(args.emitSpec),
      out: optionToUndefined(args.out),
      idMap: optionToUndefined(args.idMap),
      seed: optionToUndefined(args.seed),
      rowsCount: args.rowsCount,
      anonymize: !args.noAnonymize,
      trigger: optionToUndefined(args.trigger),
      triggerField: optionToUndefined(args.triggerField),
      triggerJson: optionToUndefined(args.triggerJson),
      fault: optionToUndefined(args.fault),
    };

    const result = yield* repro
      .run({
        connectionString: input.connection,
        baseId: input.baseId,
        tableId: input.tableId,
        taskId: input.taskId,
        deadLetterPath: input.deadLetter,
        structurePath: input.structure,
        rowsPath: input.rows,
        emitSpecPath: input.emitSpec,
        outDir: input.out,
        idMapPath: input.idMap,
        seed: input.seed,
        rowCount: input.rowsCount,
        anonymize: input.anonymize,
        triggerKind: input.trigger,
        triggerFieldId: input.triggerField,
        triggerJsonPath: input.triggerJson,
        fault: input.fault,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('repro.computed', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('repro.computed', input, result);
  });

export const reproComputed = Command.make(
  'computed',
  {
    connection: connectionOption,
    baseId: baseIdOption,
    tableId: tableIdOption,
    taskId: taskIdOption,
    deadLetter: deadLetterOption,
    structure: structureOption,
    rows: rowsOption,
    emitSpec: emitSpecOption,
    out: outOption,
    idMap: idMapOption,
    seed: seedOption,
    rowsCount: rowsCountOption,
    noAnonymize: noAnonymizeOption,
    trigger: triggerOption,
    triggerField: triggerFieldOption,
    triggerJson: triggerJsonOption,
    fault: faultOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Install a sanitized base structure into an in-memory PGlite runtime, apply one computed trigger, drain, and print the captured failure'
  )
);
