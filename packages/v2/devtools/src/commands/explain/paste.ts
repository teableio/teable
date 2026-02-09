import { Command, Options } from '@effect/cli';
import { Effect, Option } from 'effect';
import type { PasteSort, RangeType, RecordFilter, SourceFieldMeta } from '@teable/v2-core';
import { ValidationError } from '../../errors/CliError';
import { CommandExplain } from '../../services/CommandExplain';
import { Output } from '../../services/Output';
import { analyzeOption, connectionOption, tableIdOption } from '../shared';

const viewIdOption = Options.text('view-id').pipe(Options.withDescription('View ID'));
const rangesOption = Options.text('ranges').pipe(
  Options.withDescription('JSON ranges for paste selection')
);
const contentOption = Options.text('content').pipe(
  Options.withDescription('Paste content (JSON array/string or raw clipboard text)')
);
const typeOption = Options.choice('type', ['columns', 'rows']).pipe(
  Options.optional,
  Options.withDescription('Selection type (columns or rows)')
);
const filterOption = Options.text('filter').pipe(
  Options.withDescription('JSON RecordFilter (view filter override)'),
  Options.optional
);
const updateFilterOption = Options.text('update-filter').pipe(
  Options.withDescription('JSON RecordFilter (restrict updates)'),
  Options.optional
);
const sourceFieldsOption = Options.text('source-fields').pipe(
  Options.withDescription('JSON array of source field metadata'),
  Options.optional
);
const projectionOption = Options.text('projection').pipe(
  Options.withDescription('JSON array of field IDs for projection'),
  Options.optional
);
const sortOption = Options.text('sort').pipe(
  Options.withDescription('JSON array of sort definitions'),
  Options.optional
);
const typecastOption = Options.boolean('typecast').pipe(
  Options.withDefault(true),
  Options.withDescription('Enable typecast mode to auto-convert values (default: true)')
);

const parseJson = <T>(json: string, field: string): Effect.Effect<T, ValidationError> =>
  Effect.try({
    try: () => JSON.parse(json) as T,
    catch: () => new ValidationError({ message: `Invalid JSON in --${field}`, field }),
  });

const parseOptionalJson = <T>(
  json: Option.Option<string>,
  field: string
): Effect.Effect<T | undefined, ValidationError> => {
  const raw = Option.getOrUndefined(json);
  if (!raw) return Effect.succeed(undefined);
  return parseJson<T>(raw, field);
};

const parseContent = (value: string): Effect.Effect<unknown, ValidationError> =>
  Effect.try({
    try: () => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return value;
      }
    },
    catch: () => new ValidationError({ message: 'Invalid --content', field: 'content' }),
  });

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly viewId: string;
  readonly ranges: string;
  readonly content: string;
  readonly type: Option.Option<RangeType>;
  readonly filter: Option.Option<string>;
  readonly updateFilter: Option.Option<string>;
  readonly sourceFields: Option.Option<string>;
  readonly projection: Option.Option<string>;
  readonly sort: Option.Option<string>;
  readonly typecast: boolean;
  readonly analyze: boolean;
}) =>
  Effect.gen(function* () {
    const commandExplain = yield* CommandExplain;
    const output = yield* Output;

    const ranges = yield* parseJson<ReadonlyArray<readonly [number, number]>>(
      args.ranges,
      'ranges'
    );
    const content = yield* parseContent(args.content);
    const filter = yield* parseOptionalJson<RecordFilter>(args.filter, 'filter');
    const updateFilter = yield* parseOptionalJson<RecordFilter>(args.updateFilter, 'update-filter');
    const sourceFields = yield* parseOptionalJson<ReadonlyArray<SourceFieldMeta>>(
      args.sourceFields,
      'source-fields'
    );
    const projection = yield* parseOptionalJson<ReadonlyArray<string>>(
      args.projection,
      'projection'
    );
    const sort = yield* parseOptionalJson<ReadonlyArray<PasteSort>>(args.sort, 'sort');
    const type = Option.getOrUndefined(args.type);

    const input = {
      tableId: args.tableId,
      viewId: args.viewId,
      ranges,
      content,
      type,
      filter,
      updateFilter,
      sourceFields,
      projection,
      sort,
      typecast: args.typecast,
      analyze: args.analyze,
    };

    const result = yield* commandExplain
      .explainPaste({
        tableId: args.tableId,
        viewId: args.viewId,
        ranges,
        content,
        type,
        filter,
        updateFilter,
        sourceFields,
        projection,
        sort,
        typecast: args.typecast,
        analyze: args.analyze,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('explain.paste', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('explain.paste', input, result);
  });

export const explainPaste = Command.make(
  'paste',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    viewId: viewIdOption,
    ranges: rangesOption,
    content: contentOption,
    type: typeOption,
    filter: filterOption,
    updateFilter: updateFilterOption,
    sourceFields: sourceFieldsOption,
    projection: projectionOption,
    sort: sortOption,
    typecast: typecastOption,
    analyze: analyzeOption,
  },
  handler
).pipe(Command.withDescription('Explain Paste command execution plan'));
