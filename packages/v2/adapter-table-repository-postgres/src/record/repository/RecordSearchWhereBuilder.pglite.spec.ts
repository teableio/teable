import { PGlite } from '@electric-sql/pglite';
import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  RecordSearch,
  SelectOption,
  Table,
  TableId,
  TableName,
  type IRecordSearchAccessPath,
  UserMultiplicity,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Dialect } from 'kysely';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  buildRecordSearchWhereClause,
  buildRecordSearchWherePlan,
} from './RecordSearchWhereBuilder';

class PGliteDialect implements Dialect {
  constructor(private readonly client: PGlite) {}

  createAdapter() {
    return new PostgresAdapter();
  }

  createDriver() {
    return {
      acquireConnection: async () => ({
        executeQuery: async (compiledQuery: { sql: string; parameters: readonly unknown[] }) => {
          const result = await this.client.query(compiledQuery.sql, [...compiledQuery.parameters]);
          return {
            rows: result.rows,
            numAffectedRows: result.affectedRows ? BigInt(result.affectedRows) : undefined,
          };
        },
        streamQuery: async function* () {
          // eslint-disable-next-line no-constant-condition
          if (false) {
            yield undefined as never;
          }
          throw new Error('PGlite does not support streaming');
        },
      }),
      beginTransaction: async (connection: { executeQuery: (query: { sql: string }) => unknown }) =>
        connection.executeQuery({ sql: 'BEGIN', parameters: [] }),
      commitTransaction: async (connection: {
        executeQuery: (query: { sql: string }) => unknown;
      }) => connection.executeQuery({ sql: 'COMMIT', parameters: [] }),
      rollbackTransaction: async (connection: {
        executeQuery: (query: { sql: string }) => unknown;
      }) => connection.executeQuery({ sql: 'ROLLBACK', parameters: [] }),
      destroy: async () => {
        await this.client.close();
      },
      init: async () => undefined,
      releaseConnection: async () => undefined,
    };
  }

  createIntrospector(db: Kysely<unknown>) {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }
}

const sanitizeIdSeed = (seed: string): string => seed.replace(/[^0-9a-z]/gi, '0');
const createId = (prefix: string, seed: string): string =>
  `${prefix}${sanitizeIdSeed(seed).padEnd(16, '0').slice(0, 16)}`;

type SearchFixture = {
  table: Table;
  fullTableName: string;
  recordIds: {
    alpha: string;
    bravo: string;
  };
  fieldIds: {
    name: FieldId;
    owner: FieldId;
    collaborators: FieldId;
    tags: FieldId;
    due: FieldId;
    checkbox: FieldId;
  };
};

const generatedTsvectorSemanticCases = [
  {
    name: 'matches a complete token case-insensitively',
    languageConfig: 'simple',
    search: 'ALPHA',
    expected: ['alpha'],
  },
  {
    name: 'requires every unquoted token in a multi-token query',
    languageConfig: 'simple',
    search: 'alpha shipment',
    expected: ['alpha'],
  },
  {
    name: 'matches a quoted phrase in token order',
    languageConfig: 'simple',
    search: '"shipment package"',
    expected: ['alpha'],
  },
  {
    name: 'supports websearch OR syntax',
    languageConfig: 'simple',
    search: 'shipment OR billing',
    expected: ['alpha', 'bravo'],
  },
  {
    name: 'supports websearch excluded terms',
    languageConfig: 'simple',
    search: 'package -billing',
    expected: ['alpha'],
  },
  {
    name: 'matches a complete structured order number',
    languageConfig: 'simple',
    search: 'SO-123456',
    expected: ['alpha'],
  },
  {
    name: 'does not claim substring semantics for an incomplete latin token',
    languageConfig: 'simple',
    search: 'ship',
    expected: [],
  },
  {
    name: 'matches a complete CJK token under the simple configuration',
    languageConfig: 'simple',
    search: '上海订单已完成',
    expected: ['alpha'],
  },
  {
    name: 'does not claim Chinese word segmentation under the simple configuration',
    languageConfig: 'simple',
    search: '上海订单',
    expected: [],
  },
  {
    name: 'does not apply english stemming under the simple configuration',
    languageConfig: 'simple',
    search: 'run shipment',
    expected: [],
  },
  {
    name: 'applies english stemming under the english configuration',
    languageConfig: 'english',
    search: 'run shipment',
    expected: ['alpha'],
  },
] as const;

const chineseSearchWithoutJiebaCases = [
  {
    name: 'matches a complete contiguous Chinese token',
    search: '上海订单已完成',
    expectedDefault: ['alpha'],
    expectedSimpleFts: ['alpha'],
  },
  {
    name: 'shows that a meaningful Chinese prefix is not segmented by simple',
    search: '上海订单',
    expectedDefault: ['alpha'],
    expectedSimpleFts: [],
  },
  {
    name: 'shows that a shared Chinese business term remains substring-only without jieba',
    search: '订单',
    expectedDefault: ['alpha', 'bravo'],
    expectedSimpleFts: [],
  },
  {
    name: 'matches another complete contiguous Chinese token',
    search: '已取消订单',
    expectedDefault: ['bravo'],
    expectedSimpleFts: ['bravo'],
  },
  {
    name: 'combines a structured identifier with a complete Chinese token',
    search: 'SO-123456 上海订单已完成',
    expectedDefault: ['alpha'],
    expectedSimpleFts: ['alpha'],
  },
] as const;

const setupSearchFixture = async ({
  db,
  createdSchemas,
  seed,
}: {
  db: Kysely<V1TeableDatabase>;
  createdSchemas: string[];
  seed: string;
}): Promise<SearchFixture> => {
  const baseId = BaseId.create(createId('bse', seed))._unsafeUnwrap();
  const tableId = TableId.create(createId('tbl', seed))._unsafeUnwrap();
  const nameFieldId = FieldId.create(createId('fld', `n-${seed}`))._unsafeUnwrap();
  const ownerFieldId = FieldId.create(createId('fld', `o-${seed}`))._unsafeUnwrap();
  const collaboratorsFieldId = FieldId.create(createId('fld', `c-${seed}`))._unsafeUnwrap();
  const tagsFieldId = FieldId.create(createId('fld', `t-${seed}`))._unsafeUnwrap();
  const dueFieldId = FieldId.create(createId('fld', `d-${seed}`))._unsafeUnwrap();
  const checkboxFieldId = FieldId.create(createId('fld', `b-${seed}`))._unsafeUnwrap();

  const alphaOption = SelectOption.create({ name: 'Alpha', color: 'blue' })._unsafeUnwrap();
  const betaOption = SelectOption.create({ name: 'Beta', color: 'green' })._unsafeUnwrap();
  const gammaOption = SelectOption.create({ name: 'Gamma', color: 'yellow' })._unsafeUnwrap();
  const deltaOption = SelectOption.create({ name: 'Delta', color: 'red' })._unsafeUnwrap();

  const builder = Table.builder()
    .withBaseId(baseId)
    .withId(tableId)
    .withName(TableName.create(`${seed} Search Table`)._unsafeUnwrap());

  builder
    .field()
    .singleLineText()
    .withId(nameFieldId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .user()
    .withId(ownerFieldId)
    .withName(FieldName.create('Owner')._unsafeUnwrap())
    .done();
  builder
    .field()
    .user()
    .withId(collaboratorsFieldId)
    .withName(FieldName.create('Collaborators')._unsafeUnwrap())
    .withMultiplicity(UserMultiplicity.multiple())
    .done();
  builder
    .field()
    .multipleSelect()
    .withId(tagsFieldId)
    .withName(FieldName.create('Tags')._unsafeUnwrap())
    .withOptions([alphaOption, betaOption, gammaOption, deltaOption])
    .done();
  builder
    .field()
    .date()
    .withId(dueFieldId)
    .withName(FieldName.create('Due')._unsafeUnwrap())
    .done();
  builder
    .field()
    .checkbox()
    .withId(checkboxFieldId)
    .withName(FieldName.create('Checkbox')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(nameFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
    ._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(ownerFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_owner')._unsafeUnwrap())
    ._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(collaboratorsFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_collaborators')._unsafeUnwrap())
    ._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(tagsFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_tags')._unsafeUnwrap())
    ._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(dueFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_due')._unsafeUnwrap())
    ._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(checkboxFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_checkbox')._unsafeUnwrap())
    ._unsafeUnwrap();

  const schemaName = baseId.toString();
  const tableName = tableId.toString();
  const fullTableName = `${schemaName}.${tableName}`;
  createdSchemas.push(schemaName);

  await sql`CREATE SCHEMA ${sql.id(schemaName)}`.execute(db);
  await sql`
    CREATE TABLE ${sql.table(fullTableName)} (
      __id text PRIMARY KEY,
      __auto_number integer,
      col_name text,
      col_owner jsonb,
      col_collaborators jsonb,
      col_tags jsonb,
      col_due timestamp with time zone,
      col_checkbox boolean
    )
  `.execute(db);

  const alphaRecordId = createId('rec', `alpha-${seed}`);
  const bravoRecordId = createId('rec', `bravo-${seed}`);

  await sql`
    INSERT INTO ${sql.table(fullTableName)} (__id, __auto_number, col_name, col_owner, col_collaborators, col_tags, col_due, col_checkbox)
    VALUES (
      ${alphaRecordId},
      1,
      ${'Alpha'},
      ${JSON.stringify({ title: 'Visible Owner', name: 'owner@example.com', id: 'usr_alpha' })}::jsonb,
      ${JSON.stringify([{ title: 'Alice Visible', name: 'alice@example.com', id: 'usr_a' }])}::jsonb,
      ${JSON.stringify(['Alpha', 'Beta'])}::jsonb,
      ${'2026-02-24T00:00:00.000Z'}::timestamptz,
      ${true}
    )
  `.execute(db);

  await sql`
    INSERT INTO ${sql.table(fullTableName)} (__id, __auto_number, col_name, col_owner, col_collaborators, col_tags, col_due, col_checkbox)
    VALUES (
      ${bravoRecordId},
      2,
      ${'Bravo'},
      ${JSON.stringify({ title: 'Title Only', name: 'hidden-name@example.com', id: 'usr_bravo' })}::jsonb,
      ${JSON.stringify([{ title: 'Team Visible', name: 'team-hidden@example.com', id: 'usr_b' }])}::jsonb,
      ${JSON.stringify(['Gamma', 'Delta'])}::jsonb,
      ${'2026-02-25T00:00:00.000Z'}::timestamptz,
      ${false}
    )
  `.execute(db);

  return {
    table,
    fullTableName,
    recordIds: {
      alpha: alphaRecordId,
      bravo: bravoRecordId,
    },
    fieldIds: {
      name: nameFieldId,
      owner: ownerFieldId,
      collaborators: collaboratorsFieldId,
      tags: tagsFieldId,
      due: dueFieldId,
      checkbox: checkboxFieldId,
    },
  };
};

const findMatchingRecordIds = async ({
  db,
  table,
  fullTableName,
  search,
  visibleFieldIds,
  searchAccessPath,
}: {
  db: Kysely<V1TeableDatabase>;
  table: Table;
  fullTableName: string;
  search: RecordSearch;
  visibleFieldIds?: ReadonlyArray<FieldId>;
  searchAccessPath?: IRecordSearchAccessPath;
}) => {
  const whereClause = buildRecordSearchWhereClause(
    table,
    {
      search,
      visibleFieldIds,
    },
    {
      tableAlias: 't',
      searchAccessPath,
    }
  )._unsafeUnwrap();

  let query = db
    .selectFrom(`${fullTableName} as t`)
    .select('t.__id as id')
    .orderBy('t.__auto_number');

  if (whereClause != null) {
    query = query.where(whereClause);
  }

  const rows = await query.execute();

  return rows.map((row) => row.id as string);
};

const compileSearchQuery = ({
  db,
  table,
  fullTableName,
  search,
  visibleFieldIds,
  searchAccessPath,
}: {
  db: Kysely<V1TeableDatabase>;
  table: Table;
  fullTableName: string;
  search: RecordSearch;
  visibleFieldIds?: ReadonlyArray<FieldId>;
  searchAccessPath?: IRecordSearchAccessPath;
}) => {
  const whereClause = buildRecordSearchWhereClause(
    table,
    {
      search,
      visibleFieldIds,
    },
    {
      tableAlias: 't',
      searchAccessPath,
    }
  )._unsafeUnwrap();

  let query = db.selectFrom(`${fullTableName} as t`).select('t.__id as id');
  if (whereClause != null) {
    query = query.where(whereClause);
  }

  return query.compile();
};

describe('RecordSearchWhereBuilder (pglite)', () => {
  let client: PGlite;
  let db: Kysely<V1TeableDatabase>;
  const createdSchemas: string[] = [];

  beforeAll(async () => {
    client = await PGlite.create();
    db = new Kysely<V1TeableDatabase>({
      dialect: new PGliteDialect(client),
    });
  });

  afterEach(async () => {
    for (const schemaName of createdSchemas) {
      await sql`DROP SCHEMA IF EXISTS ${sql.id(schemaName)} CASCADE`.execute(db);
    }
    createdSchemas.length = 0;
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('matches single structured fields by title only, like v1 postgres search', async () => {
    const fixture = await setupSearchFixture({ db, createdSchemas, seed: 'single-structured' });

    await expect(
      findMatchingRecordIds({
        db,
        table: fixture.table,
        fullTableName: fixture.fullTableName,
        search: RecordSearch.fromTuple([
          'hidden-name@example.com',
          fixture.fieldIds.owner.toString(),
          true,
        ]),
      })
    ).resolves.toEqual([]);

    await expect(
      findMatchingRecordIds({
        db,
        table: fixture.table,
        fullTableName: fixture.fullTableName,
        search: RecordSearch.fromTuple(['Title Only', fixture.fieldIds.owner.toString(), true]),
      })
    ).resolves.toEqual([fixture.recordIds.bravo]);
  });

  it('matches multiple structured fields by aggregated title only, like v1 postgres search', async () => {
    const fixture = await setupSearchFixture({ db, createdSchemas, seed: 'multi-structured' });

    await expect(
      findMatchingRecordIds({
        db,
        table: fixture.table,
        fullTableName: fixture.fullTableName,
        search: RecordSearch.fromTuple([
          'team-hidden@example.com',
          fixture.fieldIds.collaborators.toString(),
          true,
        ]),
      })
    ).resolves.toEqual([]);

    await expect(
      findMatchingRecordIds({
        db,
        table: fixture.table,
        fullTableName: fixture.fullTableName,
        search: RecordSearch.fromTuple([
          'Team Visible',
          fixture.fieldIds.collaborators.toString(),
          true,
        ]),
      })
    ).resolves.toEqual([fixture.recordIds.bravo]);
  });

  it('returns no matches when visible search fields are explicitly empty', async () => {
    const fixture = await setupSearchFixture({ db, createdSchemas, seed: 'empty-visible' });

    await expect(
      findMatchingRecordIds({
        db,
        table: fixture.table,
        fullTableName: fixture.fullTableName,
        search: RecordSearch.fromTuple(['Alpha', '', true]),
        visibleFieldIds: [],
      })
    ).resolves.toEqual([]);
  });

  it('keeps matching multiple plain-text arrays for visible-row search', async () => {
    const fixture = await setupSearchFixture({ db, createdSchemas, seed: 'multi-text' });

    await expect(
      findMatchingRecordIds({
        db,
        table: fixture.table,
        fullTableName: fixture.fullTableName,
        search: RecordSearch.fromTuple(['Beta', fixture.fieldIds.tags.toString(), true]),
      })
    ).resolves.toEqual([fixture.recordIds.alpha]);
  });

  it('matches date fields in global visible-row search', async () => {
    const fixture = await setupSearchFixture({ db, createdSchemas, seed: 'global-date' });

    await expect(
      findMatchingRecordIds({
        db,
        table: fixture.table,
        fullTableName: fixture.fullTableName,
        search: RecordSearch.fromTuple(['2026-02-24', '', true]),
      })
    ).resolves.toEqual([fixture.recordIds.alpha]);
  });

  it('compiles date-like searches to range predicates instead of TO_CHAR matches', async () => {
    const fixture = await setupSearchFixture({ db, createdSchemas, seed: 'date-range-sql' });

    const compiled = compileSearchQuery({
      db,
      table: fixture.table,
      fullTableName: fixture.fullTableName,
      search: RecordSearch.fromTuple(['2026-02-24', fixture.fieldIds.due.toString(), true]),
    });

    expect(compiled.sql.toLowerCase()).toContain('"t"."col_due" >=');
    expect(compiled.sql.toLowerCase()).toContain('"t"."col_due" <');
    expect(compiled.sql.toLowerCase()).not.toContain('to_char(');
  });

  it('compiles multiple-select searches to a text-cast ILIKE (gin_trgm-sargable) instead of a jsonb_array_elements subquery', async () => {
    const fixture = await setupSearchFixture({ db, createdSchemas, seed: 'multi-select-sql' });

    const compiled = compileSearchQuery({
      db,
      table: fixture.table,
      fullTableName: fixture.fullTableName,
      search: RecordSearch.fromTuple(['Beta', fixture.fieldIds.tags.toString(), true]),
    });

    const lower = compiled.sql.toLowerCase();
    expect(lower).toContain('::text ilike');
    expect(lower).not.toContain('jsonb_array_elements');
  });

  it('uses a generated substring document as an index prefilter and keeps the legacy field recheck', async () => {
    const fixture = await setupSearchFixture({ db, createdSchemas, seed: 'substring-document' });
    await sql`
      ALTER TABLE ${sql.table(fixture.fullTableName)}
      ADD COLUMN __tqops_search_document text GENERATED ALWAYS AS (
        lower(COALESCE(col_name, ''))
      ) STORED
    `.execute(db);

    const accessPath: IRecordSearchAccessPath = {
      kind: 'generated_text',
      generatedColumnName: '__tqops_search_document',
      provider: 'pg_trgm',
      searchScope: 'selected_fields',
      coveredFieldIds: [fixture.fieldIds.name],
    };
    const search = RecordSearch.fromTuple(['lPh', fixture.fieldIds.name.toString(), true]);
    const compiled = compileSearchQuery({
      db,
      table: fixture.table,
      fullTableName: fixture.fullTableName,
      search,
      searchAccessPath: accessPath,
    });

    expect(compiled.sql.toLowerCase()).toContain('"t"."__tqops_search_document" like lower(');
    expect(compiled.sql.toLowerCase()).toContain(' ilike ');
    await expect(
      findMatchingRecordIds({
        db,
        table: fixture.table,
        fullTableName: fixture.fullTableName,
        search,
        searchAccessPath: accessPath,
      })
    ).resolves.toEqual([fixture.recordIds.alpha]);
  });

  it('uses pg_bigm for two-character substring probes without changing result ids', async () => {
    const fixture = await setupSearchFixture({ db, createdSchemas, seed: 'bigram-document' });
    await sql`
      ALTER TABLE ${sql.table(fixture.fullTableName)}
      ADD COLUMN __tqops_search_document text GENERATED ALWAYS AS (
        lower(COALESCE(col_name, ''))
      ) STORED
    `.execute(db);
    const search = RecordSearch.fromTuple(['Al', fixture.fieldIds.name.toString(), true]);
    const accessPath: IRecordSearchAccessPath = {
      kind: 'generated_text',
      generatedColumnName: '__tqops_search_document',
      provider: 'pg_bigm',
      searchScope: 'selected_fields',
      coveredFieldIds: [fixture.fieldIds.name],
    };

    const optimized = await findMatchingRecordIds({
      db,
      table: fixture.table,
      fullTableName: fixture.fullTableName,
      search,
      searchAccessPath: accessPath,
    });
    const legacy = await findMatchingRecordIds({
      db,
      table: fixture.table,
      fullTableName: fixture.fullTableName,
      search,
    });
    expect(optimized).toEqual(legacy);
    expect(optimized).toEqual([fixture.recordIds.alpha]);
  });

  it('preserves Chinese two-character substring results with the pg_bigm access path', async () => {
    const fixture = await setupSearchFixture({ db, createdSchemas, seed: 'bigram-chinese' });
    await sql`
      UPDATE ${sql.table(fixture.fullTableName)}
      SET col_name = '上海订单已完成'
      WHERE __id = ${fixture.recordIds.alpha}
    `.execute(db);
    await sql`
      ALTER TABLE ${sql.table(fixture.fullTableName)}
      ADD COLUMN __tqops_search_document text GENERATED ALWAYS AS (
        lower(COALESCE(col_name, ''))
      ) STORED
    `.execute(db);
    const search = RecordSearch.fromTuple(['订单', fixture.fieldIds.name.toString(), true]);
    const accessPath: IRecordSearchAccessPath = {
      kind: 'generated_text',
      generatedColumnName: '__tqops_search_document',
      provider: 'pg_bigm',
      searchScope: 'selected_fields',
      coveredFieldIds: [fixture.fieldIds.name],
    };

    const optimized = await findMatchingRecordIds({
      db,
      table: fixture.table,
      fullTableName: fixture.fullTableName,
      search,
      searchAccessPath: accessPath,
    });
    const legacy = await findMatchingRecordIds({
      db,
      table: fixture.table,
      fullTableName: fixture.fullTableName,
      search,
    });
    expect(optimized).toEqual(legacy);
    expect(optimized).toEqual([fixture.recordIds.alpha]);
  });

  it('falls back to the legacy predicate for one-character pg_bigm probes', async () => {
    const fixture = await setupSearchFixture({ db, createdSchemas, seed: 'bigram-short' });
    const plan = buildRecordSearchWherePlan(
      fixture.table,
      {
        search: RecordSearch.fromTuple(['上', fixture.fieldIds.name.toString(), true]),
        visibleFieldIds: fixture.table.fieldIds(),
      },
      {
        tableAlias: 't',
        searchAccessPath: {
          kind: 'generated_text',
          generatedColumnName: '__tqops_search_document',
          provider: 'pg_bigm',
          searchScope: 'selected_fields',
          coveredFieldIds: [fixture.fieldIds.name],
        },
      }
    )._unsafeUnwrap();

    expect(plan.usedAccessPath).toBe('default');
  });

  it('falls back to the legacy predicate for pg_trgm probes shorter than three characters', async () => {
    const fixture = await setupSearchFixture({ db, createdSchemas, seed: 'trigram-short' });
    const plan = buildRecordSearchWherePlan(
      fixture.table,
      {
        search: RecordSearch.fromTuple(['Al', fixture.fieldIds.name.toString(), true]),
        visibleFieldIds: fixture.table.fieldIds(),
      },
      {
        tableAlias: 't',
        searchAccessPath: {
          kind: 'generated_text',
          generatedColumnName: '__tqops_search_document',
          provider: 'pg_trgm',
          searchScope: 'selected_fields',
          coveredFieldIds: [fixture.fieldIds.name],
        },
      }
    )._unsafeUnwrap();

    expect(plan.usedAccessPath).toBe('default');
  });

  it('compiles field-scoped search to generated tsvector when explicitly requested and covered', async () => {
    const fixture = await setupSearchFixture({ db, createdSchemas, seed: 'fts-sql' });
    const search = RecordSearch.fromTuple(['Alpha', fixture.fieldIds.name.toString(), true]);
    const searchAccessPath = {
      kind: 'generated_tsvector' as const,
      generatedColumnName: '__tqops_search_vector',
      languageConfig: 'simple',
      searchScope: 'selected_fields' as const,
      coveredFieldIds: [fixture.fieldIds.name],
    };
    const plan = buildRecordSearchWherePlan(
      fixture.table,
      { search, visibleFieldIds: fixture.table.fieldIds() },
      { tableAlias: 't', searchAccessPath }
    )._unsafeUnwrap();

    expect(plan.usedAccessPath).toBe('generated_tsvector');

    const compiled = compileSearchQuery({
      db,
      table: fixture.table,
      fullTableName: fixture.fullTableName,
      search,
      searchAccessPath,
    });

    const lower = compiled.sql.toLowerCase();
    expect(lower).toContain('"t"."__tqops_search_vector" @@ websearch_to_tsquery');
    expect(lower).not.toContain(' ilike ');
  });

  it('falls back to default search when generated tsvector scope does not cover the requested fields', async () => {
    const fixture = await setupSearchFixture({ db, createdSchemas, seed: 'fts-fallback' });
    const search = RecordSearch.fromTuple(['Alpha', fixture.fieldIds.name.toString(), true]);
    const searchAccessPath = {
      kind: 'generated_tsvector' as const,
      generatedColumnName: '__tqops_search_vector',
      languageConfig: 'simple',
      searchScope: 'selected_fields' as const,
      coveredFieldIds: [fixture.fieldIds.owner],
    };
    const plan = buildRecordSearchWherePlan(
      fixture.table,
      { search, visibleFieldIds: fixture.table.fieldIds() },
      { tableAlias: 't', searchAccessPath }
    )._unsafeUnwrap();

    expect(plan.usedAccessPath).toBe('default');

    const compiled = compileSearchQuery({
      db,
      table: fixture.table,
      fullTableName: fixture.fullTableName,
      search,
      searchAccessPath,
    });

    const lower = compiled.sql.toLowerCase();
    expect(lower).toContain(' ilike ');
    expect(lower).not.toContain('@@ websearch_to_tsquery');
  });

  it('uses the global vector as a prefilter and rechecks an explicitly selected field', async () => {
    const fixture = await setupSearchFixture({ db, createdSchemas, seed: 'fts-scoped-recheck' });

    await sql`
      ALTER TABLE ${sql.table(fixture.fullTableName)}
      ADD COLUMN __tqops_search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector(
          'simple'::regconfig,
          COALESCE(col_name, '') || ' ' || COALESCE(col_owner::text, '')
        )
      ) STORED
    `.execute(db);

    const accessPath: IRecordSearchAccessPath = {
      kind: 'generated_tsvector',
      generatedColumnName: '__tqops_search_vector',
      languageConfig: 'simple',
      searchScope: 'all_fields',
      coveredFieldIds: [fixture.fieldIds.name, fixture.fieldIds.owner],
    };
    const compiled = compileSearchQuery({
      db,
      table: fixture.table,
      fullTableName: fixture.fullTableName,
      search: RecordSearch.fromTuple(['Title', fixture.fieldIds.name.toString(), true]),
      searchAccessPath: accessPath,
    });

    expect(compiled.sql.toLowerCase()).toContain(
      '"t"."__tqops_search_vector" @@ websearch_to_tsquery'
    );
    expect(compiled.sql.toLowerCase()).toContain('to_tsvector');
    expect(compiled.sql.toLowerCase()).not.toContain(' ilike ');
    await expect(
      findMatchingRecordIds({
        db,
        table: fixture.table,
        fullTableName: fixture.fullTableName,
        search: RecordSearch.fromTuple(['Title', fixture.fieldIds.name.toString(), true]),
        searchAccessPath: accessPath,
      })
    ).resolves.toEqual([]);
    await expect(
      findMatchingRecordIds({
        db,
        table: fixture.table,
        fullTableName: fixture.fullTableName,
        search: RecordSearch.fromTuple([
          'hidden-name@example.com',
          fixture.fieldIds.owner.toString(),
          true,
        ]),
        searchAccessPath: accessPath,
      })
    ).resolves.toEqual([]);
  });

  it('falls back for all-field search when the vector covers only a selected scope', async () => {
    const fixture = await setupSearchFixture({ db, createdSchemas, seed: 'fts-selected-global' });
    const compiled = compileSearchQuery({
      db,
      table: fixture.table,
      fullTableName: fixture.fullTableName,
      search: RecordSearch.fromTuple(['Alpha', '', true]),
      searchAccessPath: {
        kind: 'generated_tsvector',
        generatedColumnName: '__tqops_search_vector',
        languageConfig: 'simple',
        searchScope: 'selected_fields',
        coveredFieldIds: [fixture.fieldIds.name],
      },
    });

    expect(compiled.sql.toLowerCase()).toContain(' ilike ');
    expect(compiled.sql.toLowerCase()).not.toContain('@@ websearch_to_tsquery');
  });

  it('can query through a generated tsvector column for explicit full-text search validation', async () => {
    const fixture = await setupSearchFixture({ db, createdSchemas, seed: 'fts-result' });

    await sql`
      ALTER TABLE ${sql.table(fixture.fullTableName)}
      ADD COLUMN __tqops_search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('simple'::regconfig, COALESCE(col_name, ''))
      ) STORED
    `.execute(db);

    await expect(
      findMatchingRecordIds({
        db,
        table: fixture.table,
        fullTableName: fixture.fullTableName,
        search: RecordSearch.fromTuple(['Alpha', fixture.fieldIds.name.toString(), true]),
        searchAccessPath: {
          kind: 'generated_tsvector',
          generatedColumnName: '__tqops_search_vector',
          languageConfig: 'simple',
          searchScope: 'selected_fields',
          coveredFieldIds: [fixture.fieldIds.name],
        },
      })
    ).resolves.toEqual([fixture.recordIds.alpha]);
  });

  it.each(generatedTsvectorSemanticCases)('$name', async ({ languageConfig, search, expected }) => {
    const fixture = await setupSearchFixture({
      db,
      createdSchemas,
      seed: `fts-semantics-${search}`,
    });

    await sql`
      UPDATE ${sql.table(fixture.fullTableName)}
      SET col_name = CASE __id
        WHEN ${fixture.recordIds.alpha}
          THEN 'Alpha running shipment package Order SO-123456 上海订单已完成'
        WHEN ${fixture.recordIds.bravo}
          THEN 'Bravo billing package Order SO-654321 已取消订单'
        ELSE col_name
      END
    `.execute(db);
    await sql`
      ALTER TABLE ${sql.table(fixture.fullTableName)}
      ADD COLUMN __tqops_search_vector_simple tsvector GENERATED ALWAYS AS (
        to_tsvector('simple'::regconfig, COALESCE(col_name, ''))
      ) STORED
    `.execute(db);
    await sql`
      ALTER TABLE ${sql.table(fixture.fullTableName)}
      ADD COLUMN __tqops_search_vector_english tsvector GENERATED ALWAYS AS (
        to_tsvector('english'::regconfig, COALESCE(col_name, ''))
      ) STORED
    `.execute(db);

    const recordIdsByName = {
      alpha: fixture.recordIds.alpha,
      bravo: fixture.recordIds.bravo,
    } as const;
    const expectedRecordIds = expected.map((name) => recordIdsByName[name]);

    await expect(
      findMatchingRecordIds({
        db,
        table: fixture.table,
        fullTableName: fixture.fullTableName,
        search: RecordSearch.fromTuple([search, fixture.fieldIds.name.toString(), true]),
        searchAccessPath: {
          kind: 'generated_tsvector',
          generatedColumnName: `__tqops_search_vector_${languageConfig}`,
          languageConfig,
          searchScope: 'selected_fields',
          coveredFieldIds: [fixture.fieldIds.name],
        },
      })
    ).resolves.toEqual(expectedRecordIds);
  });

  describe('Chinese search semantics without jieba', () => {
    it.each(chineseSearchWithoutJiebaCases)(
      '$name',
      async ({ search, expectedDefault, expectedSimpleFts }) => {
        const fixture = await setupSearchFixture({
          db,
          createdSchemas,
          seed: `fts-chinese-${search}`,
        });

        await sql`
          UPDATE ${sql.table(fixture.fullTableName)}
          SET col_name = CASE __id
            WHEN ${fixture.recordIds.alpha}
              THEN 'Alpha Order SO-123456 上海订单已完成'
            WHEN ${fixture.recordIds.bravo}
              THEN 'Bravo Order SO-654321 已取消订单'
            ELSE col_name
          END
        `.execute(db);
        await sql`
          ALTER TABLE ${sql.table(fixture.fullTableName)}
          ADD COLUMN __tqops_search_vector_simple tsvector GENERATED ALWAYS AS (
            to_tsvector('simple'::regconfig, COALESCE(col_name, ''))
          ) STORED
        `.execute(db);

        const recordIdsByName = {
          alpha: fixture.recordIds.alpha,
          bravo: fixture.recordIds.bravo,
        } as const;
        const expectedDefaultIds = expectedDefault.map((name) => recordIdsByName[name]);
        const expectedSimpleFtsIds = expectedSimpleFts.map((name) => recordIdsByName[name]);
        const recordSearch = RecordSearch.fromTuple([
          search,
          fixture.fieldIds.name.toString(),
          true,
        ]);

        await expect(
          findMatchingRecordIds({
            db,
            table: fixture.table,
            fullTableName: fixture.fullTableName,
            search: recordSearch,
          })
        ).resolves.toEqual(expectedDefaultIds);
        await expect(
          findMatchingRecordIds({
            db,
            table: fixture.table,
            fullTableName: fixture.fullTableName,
            search: recordSearch,
            searchAccessPath: {
              kind: 'generated_tsvector',
              generatedColumnName: '__tqops_search_vector_simple',
              languageConfig: 'simple',
              searchScope: 'selected_fields',
              coveredFieldIds: [fixture.fieldIds.name],
            },
          })
        ).resolves.toEqual(expectedSimpleFtsIds);
      }
    );
  });

  it('does not filter rows for checkbox field-specific visible-row search', async () => {
    const fixture = await setupSearchFixture({ db, createdSchemas, seed: 'checkbox' });

    await expect(
      findMatchingRecordIds({
        db,
        table: fixture.table,
        fullTableName: fixture.fullTableName,
        search: RecordSearch.fromTuple(['true', fixture.fieldIds.checkbox.toString(), true]),
      })
    ).resolves.toEqual([fixture.recordIds.alpha, fixture.recordIds.bravo]);

    await expect(
      findMatchingRecordIds({
        db,
        table: fixture.table,
        fullTableName: fixture.fullTableName,
        search: RecordSearch.fromTuple(['maybe', fixture.fieldIds.checkbox.toString(), true]),
      })
    ).resolves.toEqual([fixture.recordIds.alpha, fixture.recordIds.bravo]);
  });
});
