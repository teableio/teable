import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { ValidationError } from '../../errors/CliError';
import { DebugData } from '../../services/DebugData';
import { Output } from '../../services/Output';
import {
  connectionOption,
  tableIdOption,
  limitOption,
  offsetOption,
  modeOption,
  optionToUndefined,
  parseCsv,
} from '../shared';

const searchOption = Options.text('search').pipe(
  Options.withDescription('Search text for visible-row filtering'),
  Options.optional
);

const searchFieldsOption = Options.text('search-fields').pipe(
  Options.withDescription(
    'Comma-separated field ids, names, or db field names for field-scoped search'
  ),
  Options.optional
);

const hideNotMatchRowOption = Options.boolean('hide-not-match-row').pipe(
  Options.withDefault(true),
  Options.withDescription('Filter out rows that do not match --search')
);

const searchAccessPathOption = Options.choice('search-access-path', [
  'default',
  'generated_tsvector',
]).pipe(
  Options.withDefault('default' as const),
  Options.withDescription('Search access path: default keeps ILIKE, generated_tsvector uses FTS')
);

const searchVectorColumnOption = Options.text('search-vector-column').pipe(
  Options.withDescription('Generated tsvector column name returned by Table Query Ops'),
  Options.optional
);

const searchVectorLanguageConfigOption = Options.text('search-vector-language-config').pipe(
  Options.withDefault('simple'),
  Options.withDescription('Postgres text search configuration for generated_tsvector')
);

const searchVectorFieldIdsOption = Options.text('search-vector-field-ids').pipe(
  Options.withDescription('Comma-separated field IDs covered by the generated tsvector column'),
  Options.optional
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly limit: number;
  readonly offset: number;
  readonly mode: 'stored' | 'computed';
  readonly search: Option.Option<string>;
  readonly searchFields: Option.Option<string>;
  readonly hideNotMatchRow: boolean;
  readonly searchAccessPath: 'default' | 'generated_tsvector';
  readonly searchVectorColumn: Option.Option<string>;
  readonly searchVectorLanguageConfig: string;
  readonly searchVectorFieldIds: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const debugData = yield* DebugData;
    const output = yield* Output;
    const search = optionToUndefined(args.search);
    const searchFields = optionToUndefined(args.searchFields);
    const searchVectorColumn = optionToUndefined(args.searchVectorColumn);
    const searchVectorFieldIds = parseCsv(optionToUndefined(args.searchVectorFieldIds));

    if (args.searchAccessPath === 'generated_tsvector' && !search) {
      return yield* Effect.fail(
        new ValidationError({
          message: '--search is required when --search-access-path generated_tsvector is used',
          field: 'search',
        })
      );
    }

    if (args.searchAccessPath === 'generated_tsvector' && !searchVectorColumn) {
      return yield* Effect.fail(
        new ValidationError({
          message:
            '--search-vector-column is required when --search-access-path generated_tsvector is used',
          field: 'search-vector-column',
        })
      );
    }

    if (args.searchAccessPath === 'generated_tsvector' && searchVectorFieldIds.length === 0) {
      return yield* Effect.fail(
        new ValidationError({
          message:
            '--search-vector-field-ids is required when --search-access-path generated_tsvector is used',
          field: 'search-vector-field-ids',
        })
      );
    }

    const input = {
      tableId: args.tableId,
      limit: args.limit,
      offset: args.offset,
      mode: args.mode,
      search,
      searchFields,
      hideNotMatchRow: args.hideNotMatchRow,
      searchAccessPath: args.searchAccessPath,
      searchVectorColumn,
      searchVectorLanguageConfig: args.searchVectorLanguageConfig,
      searchVectorFieldIds,
    };

    const result = yield* debugData
      .getRecords(args.tableId, {
        limit: args.limit,
        offset: args.offset,
        mode: args.mode,
        search,
        searchFieldKeys: searchFields,
        hideNotMatchRow: args.hideNotMatchRow,
        searchAccessPath:
          args.searchAccessPath === 'generated_tsvector'
            ? {
                kind: 'generated_tsvector',
                generatedColumnName: searchVectorColumn as string,
                languageConfig: args.searchVectorLanguageConfig,
                searchScope: 'all_fields',
                coveredFieldIds: searchVectorFieldIds,
              }
            : { kind: 'default' },
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('records.list', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    if (result.records.length === 0) {
      yield* output.empty(
        'records.list',
        input,
        `No records found in table "${args.tableId}". The table may be empty or the offset is too large.`
      );
      return;
    }

    yield* output.success('records.list', input, result);
  });

export const recordsList = Command.make(
  'list',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    limit: limitOption,
    offset: offsetOption,
    mode: modeOption,
    search: searchOption,
    searchFields: searchFieldsOption,
    hideNotMatchRow: hideNotMatchRowOption,
    searchAccessPath: searchAccessPathOption,
    searchVectorColumn: searchVectorColumnOption,
    searchVectorLanguageConfig: searchVectorLanguageConfigOption,
    searchVectorFieldIds: searchVectorFieldIdsOption,
  },
  handler
).pipe(Command.withDescription('List records via application query repository'));
