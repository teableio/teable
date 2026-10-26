import {
  ActorId,
  buildRecordConditionSpec,
  DefaultTableMapper,
  domainError,
  MemoryTableRepository,
  NoopLogger,
  RecordQueryPluginRunner,
  type IRecordQueryPlugin,
  type ITablePersistenceDTO,
  type RecordQueryPluginScope,
  type Table,
} from '@teable/v2-core';
import { DataQueryDefinition, DataQueryService } from '@teable/v2-data-query';
import { sql } from 'kysely';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createPGliteDb,
  type PGliteTestDb,
} from '../../schema/visitors/__tests__/helpers/createPGliteDb';
import { normalizeDataQueryValue } from './normalizeDataQueryValue';
import { PostgresDataQueryExecutor } from './PostgresDataQueryExecutor';

const tableId = 'tblaaaaaaaaaaaaaaaa';
const titleId = 'fldaaaaaaaaaaaaaaaa';
const amountId = 'fldbbbbbbbbbbbbbbbb';
const categoryId = 'fldcccccccccccccccc';
const checkedId = 'flddddddddddddddddd';
const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
const physicalTable = 'Mixed "表';
const physicalTitle = 'Title.with.dot "值';
const mapper = new DefaultTableMapper();

const tableDto = (titleColumn = physicalTitle): ITablePersistenceDTO => ({
  id: tableId,
  baseId: 'bseaaaaaaaaaaaaaaaa',
  name: 'Query test',
  dbTableName: `public.${physicalTable}`,
  primaryFieldId: titleId,
  fields: [
    { id: titleId, name: 'Title', type: 'singleLineText', dbFieldName: titleColumn },
    {
      id: amountId,
      name: 'Amount',
      type: 'number',
      dbFieldName: 'amount',
      options: { formatting: { type: 'decimal', precision: 2 } },
    },
    { id: categoryId, name: 'Category', type: 'singleLineText', dbFieldName: 'category' },
    { id: checkedId, name: 'Checked', type: 'checkbox', dbFieldName: 'checked' },
  ],
  views: [{ id: 'viwaaaaaaaaaaaaaaaa', name: 'Grid', type: 'grid', columnMeta: {} }],
});

const recordsDefinition = (filter?: unknown) =>
  DataQueryDefinition.create({
    version: 1,
    tableId,
    kind: 'records',
    select: [
      { system: 'id', alias: 'id' },
      { fieldId: titleId, alias: 'display "名' },
      { fieldId: amountId, alias: 'amount' },
    ],
    ...(filter ? { filter } : {}),
  })._unsafeUnwrap();

describe('PostgresDataQueryExecutor real SQL', () => {
  let database: PGliteTestDb;
  let table: Table;
  let executor: PostgresDataQueryExecutor;

  beforeEach(async () => {
    database = await createPGliteDb();
    table = mapper.toDomain(tableDto())._unsafeUnwrap();
    executor = new PostgresDataQueryExecutor(database.db);
    await sql`create table ${sql.id('public', physicalTable)} (
      __id text primary key, ${sql.id(physicalTitle)} text, amount double precision,
      category text, checked boolean, __created_time timestamptz default '2026-01-01T00:00:00Z',
      __last_modified_time timestamptz, __auto_number bigint, __version integer default 1
    )`.execute(database.db);
    for (const [id, title, amount, category, checked, auto] of [
      ['recC', 'Gamma', 10, 'x', false, 3],
      ['recA', "O'Reilly'); drop table nope; --", 10, 'x', true, 1],
      ['recB', 'Beta', 20, 'y', null, 2],
      ['recD', null, null, null, null, 4],
    ]) {
      await sql`insert into ${sql.id('public', physicalTable)}
        (__id, ${sql.id(physicalTitle)}, amount, category, checked, __auto_number)
        values (${id}, ${title}, ${amount}, ${category}, ${checked}, ${auto})`.execute(database.db);
    }
  });

  afterEach(async () => {
    await database.db.destroy();
  });

  it('describes composite user/link wire values and preserves unsafe numeric strings', async () => {
    const userId = `fld${'u'.repeat(16)}`;
    const linkId = `fld${'l'.repeat(16)}`;
    const dto = tableDto();
    dto.fields.push(
      {
        id: userId,
        name: 'Owner',
        type: 'user',
        dbFieldName: 'owner',
        options: { isMultiple: false },
      },
      {
        id: linkId,
        name: 'Related',
        type: 'link',
        dbFieldName: 'related',
        options: {
          relationship: 'manyOne',
          foreignTableId: `tbl${'f'.repeat(16)}`,
          lookupFieldId: titleId,
          isOneWay: true,
          fkHostTableName: dto.dbTableName,
          selfKeyName: '__id',
          foreignKeyName: 'fk_related',
        },
      }
    );
    table = mapper.toDomain(dto)._unsafeUnwrap();
    await sql`alter table ${sql.id('public', physicalTable)} add column owner jsonb, add column related jsonb`.execute(
      database.db
    );
    const owner = { id: 'usrSynthetic', title: 'Synthetic owner' };
    const related = { id: `rec${'z'.repeat(16)}`, title: 'Synthetic related record' };
    await sql`update ${sql.id('public', physicalTable)} set owner = ${JSON.stringify(owner)}::jsonb,
      related = ${JSON.stringify(related)}::jsonb, __auto_number = 9007199254740993 where __id = 'recA'`.execute(
      database.db
    );
    const definition = DataQueryDefinition.create({
      version: 1,
      tableId,
      kind: 'records',
      page: { limit: 1 },
      select: [
        { fieldId: userId, alias: 'owner' },
        { fieldId: linkId, alias: 'related' },
        { system: 'autoNumber', alias: 'sequence' },
      ],
    })._unsafeUnwrap();
    const service = new DataQueryService(
      { findOne: async () => ok(table) },
      new RecordQueryPluginRunner([], new NoopLogger()),
      executor
    );
    expect((await service.validate(context, definition))._unsafeUnwrap().outputs).toEqual([
      {
        alias: 'owner',
        cellValueType: 'string',
        wireType: 'unknown',
        isMultipleCellValue: false,
        nullable: true,
      },
      {
        alias: 'related',
        cellValueType: 'string',
        wireType: 'unknown',
        isMultipleCellValue: false,
        nullable: true,
      },
      {
        alias: 'sequence',
        cellValueType: 'number',
        wireType: 'numberOrString',
        isMultipleCellValue: false,
        nullable: false,
      },
    ]);
    expect((await service.execute(context, definition))._unsafeUnwrap().rows).toEqual([
      { owner, related, sequence: '9007199254740993' },
    ]);
    expect(normalizeDataQueryValue('9007199254740993', 'sum')).toBe('9007199254740993');
  });

  it('parameterizes recordId and intersects it with the mandatory row scope', async () => {
    const recordId = `rec${'r'.repeat(16)}`;
    await sql`insert into ${sql.id('public', physicalTable)} (__id, category) values (${recordId}, 'visible')`.execute(
      database.db
    );
    const definition = DataQueryDefinition.create({
      ...recordsDefinition().snapshot(),
      parameters: { id: { type: 'string' } },
      recordId: { type: 'parameter', name: 'id' },
    })._unsafeUnwrap();
    const query = definition.bind({ id: recordId })._unsafeUnwrap();
    const recordSpec = buildRecordConditionSpec(table, {
      fieldId: categoryId,
      operator: 'is',
      value: 'visible',
    })._unsafeUnwrap();
    const compiled = executor.compile(context, table, query, { recordSpec })._unsafeUnwrap();
    expect(compiled.sql).toContain('"t"."__id" = $');
    expect(compiled.sql).not.toContain(recordId);
    expect(compiled.parameters).toContain(recordId);
    expect(
      (await executor.execute(context, table, query, { recordSpec }))
        ._unsafeUnwrap()
        .rows.map((row) => row.id)
    ).toEqual([recordId]);
    const forbidden = buildRecordConditionSpec(table, {
      fieldId: categoryId,
      operator: 'is',
      value: 'other',
    })._unsafeUnwrap();
    expect(
      (
        await executor.execute(context, table, query, {
          recordSpec: forbidden,
          skipRecordSpec: true,
        })
      )._unsafeUnwrap().rows
    ).toEqual([]);
  });

  it('quotes identifiers and stable aliases while parameterizing public inputs', async () => {
    const definition = DataQueryDefinition.create({
      ...recordsDefinition().snapshot(),
      parameters: {
        title: { type: 'string' },
        category: { type: 'string' },
      },
      filter: {
        conjunction: 'and',
        items: [
          { fieldId: titleId, operator: 'is', value: { type: 'parameter', name: 'title' } },
          { fieldId: categoryId, operator: 'is', value: { type: 'parameter', name: 'category' } },
        ],
      },
    })._unsafeUnwrap();
    const bound = definition
      .bind({ title: "O'Reilly'); drop table nope; --", category: 'x' })
      ._unsafeUnwrap();
    const compiled = executor.compile(context, table, bound, {})._unsafeUnwrap();
    expect(compiled.parameters).toContain("O'Reilly'); drop table nope; --");
    expect((await executor.execute(context, table, bound, {}))._unsafeUnwrap().rows).toEqual([
      { id: 'recA', 'display "名': "O'Reilly'); drop table nope; --", amount: 10 },
    ]);
    expect(definition.bind({ title: 'Beta', undeclared: 'y' }).isErr()).toBe(true);
    expect(
      (
        await executor.execute(
          context,
          table,
          definition.bind({ title: 'Beta', category: 'x' })._unsafeUnwrap(),
          {}
        )
      )._unsafeUnwrap().rows
    ).toEqual([]);
    expect(
      (
        await executor.execute(
          context,
          table,
          definition.bind({ title: 'Beta', category: 'y' })._unsafeUnwrap(),
          {}
        )
      )._unsafeUnwrap().rows[0]?.id
    ).toBe('recB');
  });

  it('uses record ID as a deterministic tie-breaker across pages', async () => {
    const definition = DataQueryDefinition.create({
      ...recordsDefinition({ fieldId: amountId, operator: 'is', value: 10 }).snapshot(),
      sort: [{ fieldId: amountId, order: 'desc' }],
      parameters: { offset: { type: 'number' } },
      page: { limit: 1, offset: { type: 'parameter', name: 'offset' } },
    })._unsafeUnwrap();
    const first = (
      await executor.execute(context, table, definition.bind({ offset: 0 })._unsafeUnwrap(), {})
    )._unsafeUnwrap();
    const second = (
      await executor.execute(context, table, definition.bind({ offset: 1 })._unsafeUnwrap(), {})
    )._unsafeUnwrap();
    expect(first.rows.map((row) => row.id)).toEqual(['recA']);
    expect(second.rows.map((row) => row.id)).toEqual(['recC']);
  });

  it('groups numeric aggregates and preserves empty/null SQL semantics', async () => {
    const definition = DataQueryDefinition.create({
      version: 1,
      tableId,
      kind: 'aggregate',
      groupBy: [{ fieldId: categoryId, alias: 'bucket' }],
      aggregates: [
        { fieldId: amountId, statisticFunc: 'count', alias: 'count' },
        { fieldId: amountId, statisticFunc: 'sum', alias: 'total' },
      ],
    })._unsafeUnwrap();
    expect(
      (
        await executor.execute(context, table, definition.bind({})._unsafeUnwrap(), {})
      )._unsafeUnwrap().rows
    ).toEqual([
      { bucket: null, count: 1, total: null },
      { bucket: 'x', count: 2, total: 20 },
      { bucket: 'y', count: 1, total: 20 },
    ]);
    const empty = DataQueryDefinition.create({
      ...definition.snapshot(),
      groupBy: [],
      filter: { fieldId: categoryId, operator: 'is', value: 'missing' },
    })._unsafeUnwrap();
    expect(
      (await executor.execute(context, table, empty.bind({})._unsafeUnwrap(), {}))._unsafeUnwrap()
        .rows
    ).toEqual([{ count: 0, total: null }]);
    const unchecked = recordsDefinition({ fieldId: checkedId, operator: 'is', value: null });
    expect(
      (await executor.execute(context, table, unchecked.bind({})._unsafeUnwrap(), {}))
        ._unsafeUnwrap()
        .rows.map((row) => row.id)
    ).toEqual(['recB', 'recC', 'recD']);
  });

  it.each(['createdBy', 'lastModifiedBy'] as const)(
    'aggregates historical %s TEXT identities without a JSON cast failure',
    async (fieldType) => {
      const userId = `fld${'u'.repeat(16)}`;
      const dto = tableDto();
      dto.fields.push({
        id: userId,
        name: 'System user',
        type: fieldType,
        dbFieldName: 'system_user',
      });
      table = mapper.toDomain(dto)._unsafeUnwrap();
      const physical = sql.id('public', physicalTable);
      await sql`alter table ${physical} add column "system_user" text`.execute(database.db);
      await sql`update ${physical} set "system_user" = case
        when __id in ('recA', 'recB') then 'user-a'
        when __id = 'recC' then 'user-b'
        else null end`.execute(database.db);
      const query = DataQueryDefinition.create({
        version: 1,
        kind: 'aggregate',
        tableId,
        aggregates: [
          { fieldId: userId, alias: 'unique', statisticFunc: 'unique' },
          { fieldId: userId, alias: 'percentUnique', statisticFunc: 'percentUnique' },
          { fieldId: userId, alias: 'count', statisticFunc: 'count' },
        ],
      })
        ._unsafeUnwrap()
        .bind({})
        ._unsafeUnwrap();
      expect((await executor.execute(context, table, query, {}))._unsafeUnwrap().rows).toEqual([
        { unique: 2, percentUnique: 50, count: 4 },
      ]);
      const visibleWhen = buildRecordConditionSpec(table, {
        fieldId: titleId,
        operator: 'is',
        value: 'Beta',
      })._unsafeUnwrap();
      expect(
        (
          await executor.execute(context, table, query, {
            fieldMasks: [{ fieldId: userId, visibleWhen }],
          })
        )._unsafeUnwrap().rows
      ).toEqual([{ unique: 1, percentUnique: 25, count: 4 }]);
      await sql`alter table ${physical} alter column "system_user" type jsonb using
        case when "system_user" is null then null else jsonb_build_object('id', "system_user", 'name', 'Original') end`.execute(
        database.db
      );
      await sql`update ${physical} set "system_user" = jsonb_build_object('id', 'user-a', 'name', 'Renamed') where __id = 'recB'`.execute(
        database.db
      );
      expect((await executor.execute(context, table, query, {}))._unsafeUnwrap().rows).toEqual([
        { unique: 2, percentUnique: 50, count: 4 },
      ]);
    }
  );

  it('intersects fresh row scope and masks projection, filtering, ordering and aggregates', async () => {
    const visibility = buildRecordConditionSpec(table, {
      fieldId: categoryId,
      operator: 'is',
      value: 'x',
    })._unsafeUnwrap();
    const scope: RecordQueryPluginScope = {
      fieldMasks: [{ fieldId: amountId, visibleWhen: visibility }],
    };
    const definition = DataQueryDefinition.create({
      ...recordsDefinition().snapshot(),
      sort: [{ fieldId: amountId, order: 'asc' }],
    })._unsafeUnwrap();
    const bound = definition.bind({})._unsafeUnwrap();
    expect(
      (await executor.execute(context, table, bound, scope))
        ._unsafeUnwrap()
        .rows.map((row) => [row.id, row.amount])
    ).toEqual([
      ['recB', null],
      ['recD', null],
      ['recA', 10],
      ['recC', 10],
    ]);
    const filtered = recordsDefinition({ fieldId: amountId, operator: 'is', value: 20 })
      .bind({})
      ._unsafeUnwrap();
    expect((await executor.execute(context, table, filtered, scope))._unsafeUnwrap().rows).toEqual(
      []
    );
    expect(
      (await executor.execute(context, table, filtered, {}))
        ._unsafeUnwrap()
        .rows.map((row) => row.id)
    ).toEqual(['recB']);
    expect(
      (
        await executor.execute(context, table, bound, {
          ...scope,
          recordSpec: visibility,
          skipRecordSpec: true,
        })
      )
        ._unsafeUnwrap()
        .rows.map((row) => row.id)
    ).toEqual(['recA', 'recC']);
    const aggregate = DataQueryDefinition.create({
      version: 1,
      tableId,
      kind: 'aggregate',
      aggregates: [{ fieldId: amountId, statisticFunc: 'sum', alias: 'total' }],
    })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    const restrictedScope = { ...scope, readableFieldIds: new Set([titleId]) };
    expect(
      (await executor.execute(context, table, aggregate, restrictedScope))._unsafeUnwrap().rows
    ).toEqual([{ total: 20 }]);
    expect((await executor.execute(context, table, bound, restrictedScope)).isErr()).toBe(true);
    expect(executor.compile(context, table, { ...filtered, filter: undefined }, {}).isErr()).toBe(
      true
    );
  });

  it('compares user identities and primitive field references using each operand storage shape', async () => {
    const ownerId = `fld${'u'.repeat(16)}`;
    const expectedUserId = `fld${'v'.repeat(16)}`;
    const ownersId = `fld${'w'.repeat(16)}`;
    const expectedUsersId = `fld${'x'.repeat(16)}`;
    const choiceId = `fld${'s'.repeat(16)}`;
    const dto = tableDto();
    dto.fields.push(
      {
        id: ownerId,
        name: 'Owner',
        type: 'user',
        dbFieldName: 'owner',
        options: { isMultiple: false },
      },
      {
        id: expectedUserId,
        name: 'Expected user',
        type: 'user',
        dbFieldName: 'expected_user',
        options: { isMultiple: false },
      },
      {
        id: ownersId,
        name: 'Owners',
        type: 'user',
        dbFieldName: 'owners',
        options: { isMultiple: true },
      },
      {
        id: expectedUsersId,
        name: 'Expected users',
        type: 'user',
        dbFieldName: 'expected_users',
        options: { isMultiple: true },
      },
      {
        id: choiceId,
        name: 'Choice',
        type: 'singleSelect',
        dbFieldName: 'choice',
        options: { choices: [] },
      }
    );
    table = mapper.toDomain(dto)._unsafeUnwrap();
    await sql`alter table ${sql.id('public', physicalTable)}
      add column owner jsonb, add column expected_user jsonb,
      add column owners jsonb, add column expected_users jsonb, add column choice text`.execute(
      database.db
    );
    await sql`delete from ${sql.id('public', physicalTable)}`.execute(database.db);
    for (const [id, expected] of [
      ['recEqual', 'usrAlice'],
      ['recDifferent', 'usrBob'],
    ]) {
      await sql`insert into ${sql.id('public', physicalTable)}
        (__id, ${sql.id(physicalTitle)}, category, owner, expected_user, owners, expected_users, choice)
        values (${id}, 'usrAlice', ${expected},
          ${JSON.stringify({ id: 'usrAlice', title: 'Alice' })}::jsonb,
          ${JSON.stringify({ id: expected, title: 'Different display name' })}::jsonb,
          ${JSON.stringify([{ id: 'usrAlice' }, { id: 'usrCarol' }])}::jsonb,
          ${JSON.stringify([{ id: expected }])}::jsonb, 'usrAlice')`.execute(database.db);
    }
    const service = new DataQueryService(
      { findOne: async () => ok(table) },
      new RecordQueryPluginRunner([], new NoopLogger()),
      executor
    );
    const cases = [
      // The reported user -> plain text case, plus the reverse storage direction.
      { fieldId: ownerId, referenceId: categoryId, positive: 'isAnyOf', negative: 'isNoneOf' },
      { fieldId: choiceId, referenceId: expectedUserId, positive: 'isAnyOf', negative: 'isNoneOf' },
      // Control: multiple user field overlap.
      {
        fieldId: ownersId,
        referenceId: expectedUsersId,
        positive: 'hasAnyOf',
        negative: 'hasNoneOf',
      },
    ];
    for (const { fieldId, referenceId, positive, negative } of cases) {
      for (const [operator, expectedId] of [
        [positive, 'recEqual'],
        [negative, 'recDifferent'],
      ]) {
        const definition = recordsDefinition({
          fieldId,
          operator,
          value: { type: 'field', fieldId: referenceId },
        });
        expect((await service.validate(context, definition)).isOk()).toBe(true);
        const result = (await service.execute(context, definition))._unsafeUnwrap();
        expect(result.rows.map((row) => row.id)).toEqual([expectedId]);
      }
    }
    const literal = recordsDefinition({
      fieldId: ownerId,
      operator: 'isNoneOf',
      value: ['usrAlice'],
    });
    expect((await service.validate(context, literal)).isOk()).toBe(true);
    expect((await service.execute(context, literal))._unsafeUnwrap().rows).toEqual([]);
  });

  it('resolves Me from each execution actor without altering literal text filters', async () => {
    const userId = `fld${'u'.repeat(16)}`;
    const dto = tableDto();
    dto.fields = [
      ...dto.fields,
      {
        id: userId,
        name: 'Owner',
        type: 'user',
        dbFieldName: 'owner',
        options: { isMultiple: false },
      },
    ];
    table = mapper.toDomain(dto)._unsafeUnwrap();
    await sql`alter table ${sql.id('public', physicalTable)} add column owner jsonb`.execute(
      database.db
    );
    await sql`update ${sql.id('public', physicalTable)} set owner = jsonb_build_object('id', 'alice') where __id = 'recA'`.execute(
      database.db
    );
    await sql`update ${sql.id('public', physicalTable)} set owner = jsonb_build_object('id', 'bob') where __id = 'recB'`.execute(
      database.db
    );
    const bound = recordsDefinition({ fieldId: userId, operator: 'is', value: 'Me' })
      .bind({})
      ._unsafeUnwrap();
    for (const [actor, expected] of [
      ['alice', 'recA'],
      ['bob', 'recB'],
    ]) {
      const result = await executor.execute(
        { actorId: ActorId.create(actor)._unsafeUnwrap() },
        table,
        bound,
        {}
      );
      expect(result._unsafeUnwrap().rows.map((row) => row.id)).toEqual([expected]);
    }
    const excluded = recordsDefinition({ fieldId: userId, operator: 'isNot', value: 'Me' })
      .bind({})
      ._unsafeUnwrap();
    const result = await executor.execute(
      { actorId: ActorId.create('alice')._unsafeUnwrap() },
      table,
      excluded,
      {}
    );
    expect(result._unsafeUnwrap().rows.map((row) => row.id)).toEqual(['recB', 'recC', 'recD']);
    const literal = recordsDefinition({ fieldId: titleId, operator: 'is', value: 'Me' })
      .bind({})
      ._unsafeUnwrap();
    expect((await executor.execute(context, table, literal, {}))._unsafeUnwrap().rows).toEqual([]);
  });

  it('reloads schema and permissions through the real service without stale binding bypass', async () => {
    const repository = new MemoryTableRepository();
    (await repository.insert(context, table))._unsafeUnwrap();
    let denied = false;
    let onlyX = false;
    const plugin: IRecordQueryPlugin = {
      name: 'test-current-authorization',
      supports: () => true,
      guard: () => (denied ? err(domainError.forbidden({ message: 'Denied' })) : ok(undefined)),
      scope: ({ table: current }) =>
        onlyX
          ? buildRecordConditionSpec(current, {
              fieldId: categoryId,
              operator: 'is',
              value: 'x',
            }).map((recordSpec) => ({ recordSpec }))
          : ok({}),
    };
    const service = new DataQueryService(
      repository,
      new RecordQueryPluginRunner([plugin], new NoopLogger()),
      executor
    );
    const binding = recordsDefinition();
    expect((await service.execute(context, binding))._unsafeUnwrap().rows).toHaveLength(4);
    const renamed = 'Renamed "新';
    await sql`alter table ${sql.id('public', physicalTable)} rename column ${sql.id(physicalTitle)} to ${sql.id(renamed)}`.execute(
      database.db
    );
    (await repository.delete(context, table))._unsafeUnwrap();
    table = mapper.toDomain(tableDto(renamed))._unsafeUnwrap();
    (await repository.insert(context, table))._unsafeUnwrap();
    onlyX = true;
    expect(
      (await service.execute(context, binding))._unsafeUnwrap().rows.map((row) => row.id)
    ).toEqual(['recA', 'recC']);
    denied = true;
    expect((await service.execute(context, binding)).isErr()).toBe(true);
    denied = false;
    const changed: ITablePersistenceDTO = {
      ...tableDto(renamed),
      fields: tableDto(renamed).fields.filter((field) => field.id !== amountId),
    };
    (await repository.delete(context, table))._unsafeUnwrap();
    table = mapper.toDomain(changed)._unsafeUnwrap();
    (await repository.insert(context, table))._unsafeUnwrap();
    expect((await service.execute(context, binding)).isErr()).toBe(true);
  });

  it('normalizes dates and bigints without prototype mutation or rounding', async () => {
    const definition = DataQueryDefinition.create({
      version: 1,
      tableId,
      kind: 'records',
      select: [
        { system: 'createdTime', alias: 'created' },
        { system: 'autoNumber', alias: 'sequence' },
      ],
      page: { limit: 1 },
    })._unsafeUnwrap();
    expect(
      (
        await executor.execute(context, table, definition.bind({})._unsafeUnwrap(), {})
      )._unsafeUnwrap().rows
    ).toEqual([{ created: '2026-01-01T00:00:00.000Z', sequence: 1 }]);
    expect(normalizeDataQueryValue('9007199254740993', 'count')).toBe('9007199254740993');
    expect(normalizeDataQueryValue(9007199254740993n)).toBe('9007199254740993');
    expect(normalizeDataQueryValue('2', 'count')).toBe(2);
    expect(normalizeDataQueryValue(JSON.parse('{"__proto__":{"x":1},"constructor":"ok"}'))).toEqual(
      JSON.parse('{"__proto__":{"x":1},"constructor":"ok"}')
    );
  });

  it('groups a bucket whose alias equals the field id without duplicating rows', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId,
      aggregates: [{ fieldId: titleId, statisticFunc: 'count', alias: 'rows' }],
      groupBy: [
        {
          fieldId: amountId,
          alias: amountId,
          bucket: {
            kind: 'numericRange',
            edges: [{ maxExclusive: 15, label: 'low' }],
            fallbackLabel: 'high',
            nullLabel: 'missing',
          },
        },
      ],
      sort: [{ alias: amountId, order: 'asc' }],
      page: { limit: 10, includeTotal: true },
    })._unsafeUnwrap();

    const result = await executor.execute(context, table, definition.bind({})._unsafeUnwrap(), {});

    const rows = result._unsafeUnwrap().rows;
    expect(rows.map((row) => row[amountId])).toEqual(['high', 'low', 'missing']);
    expect(rows).toEqual([
      { [amountId]: 'high', rows: 1 },
      { [amountId]: 'low', rows: 2 },
      { [amountId]: 'missing', rows: 1 },
    ]);
    expect(rows.length).toBe(result._unsafeUnwrap().page?.total);
    expect(result._unsafeUnwrap().page).toEqual({ limit: 10, offset: 0, total: 3 });
  });
});
