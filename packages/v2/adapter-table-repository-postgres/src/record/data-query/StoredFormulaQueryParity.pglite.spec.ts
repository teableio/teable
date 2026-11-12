/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Real stored-computed vs query-compiled formula parity.
 *
 * Every formula is evaluated twice against the same synthetic row:
 *  1. stored path: a computed formula field persisted by the real outbox worker,
 *     read back through the stored record query repository;
 *  2. query path: a v3 formula projection whose text is byte-identical to the
 *     stored expression, with its reference map bound to the same field ids.
 *
 * Both sides are additionally checked against explicit expected values, so two
 * wrong results cannot pass by merely agreeing with each other.
 *
 * Deliberately not used: handwritten SQL computed columns and the
 * FormulaSqlPgTestkit oracle (it clears computed columns and executes freshly
 * translated SQL). The stored side here is whatever the production computed
 * pipeline actually persisted.
 */
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateFieldCommand,
  CreateRecordCommand,
  CreateTableCommand,
  FormulaField,
  NoopLogger,
  RecordQueryPluginRunner,
  UpdateRecordCommand,
  v2CoreTokens,
  type CreateFieldResult,
  type CreateRecordResult,
  type CreateTableResult,
  type ICommandBus,
  type IExecutionContext,
  type ITableRecordQueryRepository,
  type UpdateRecordResult,
} from '@teable/v2-core';
import {
  DataQueryDefinition,
  DataQueryService,
  type DataQueryFormulaExpression,
  type DataQueryFormulaReference,
  type DataQueryPredicateV3,
} from '@teable/v2-data-query';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresDataQueryExecutor } from './PostgresDataQueryExecutor';

const fieldId = (label: string): string => `fld${label.padEnd(16, '0')}`;

const shanghai = 'Asia/Shanghai';
const utc = 'UTC';
const alphaUserId = 'usrAlphaOwner00001';
const betaUserId = 'usrBetaOwner00002';
const sentinelEmail = 'sentinel.do.not.leak@synthetic.invalid';

/** Source fields: the value categories the reported bug involved. */
const fields = {
  title: fieldId('title'),
  owner: fieldId('owner'),
  peer: fieldId('peer'),
  score: fieldId('score'),
  blank: fieldId('blank'),
  price: fieldId('price'),
  wide: fieldId('wide'),
  due: fieldId('due'),
  qty: fieldId('qty'),
  peerTitle: fieldId('peerTitle'),
  peerScore: fieldId('peerScore'),
} as const;

/** Stored computed formula fields, one per formula asserted below. */
const stored = {
  userText: fieldId('fuser'),
  linkText: fieldId('flink'),
  lookupMath: fieldId('flookup'),
  blankSum: fieldId('fblank'),
  blankNull: fieldId('fnull'),
  priceProduct: fieldId('fprice'),
  wideDouble: fieldId('fwide'),
  dueShanghai: fieldId('fzone'),
  dueUtc: fieldId('futc'),
  blankIsZero: fieldId('fzero'),
  blankPositive: fieldId('fpos'),
} as const;

/**
 * One source of truth for formula text: the stored field and the query projection
 * both read these strings, and both bind the `{fld...}` tokens to the same ids.
 */
const formulaText = {
  userText: `LOWER({${fields.owner}})`,
  linkText: `LOWER({${fields.peer}})`,
  lookupMath: `{${fields.score}} * 2`,
  blankSum: `{${fields.blank}} + 1`,
  blankNull: `IF({${fields.blank}}, {${fields.blank}}, BLANK())`,
  priceProduct: `{${fields.price}} * {${fields.qty}}`,
  wideDouble: `{${fields.wide}} * 2`,
  dueShanghai: `DATETIME_FORMAT({${fields.due}}, "YYYY-MM-DD HH:mm")`,
  dueUtc: `DATETIME_FORMAT({${fields.due}}, "YYYY-MM-DD HH:mm")`,
  blankIsZero: `{${fields.blank}} = 0`,
  blankPositive: `{${fields.blank}} > 0`,
} as const;

type RecordLabel = 'alpha' | 'beta' | 'gamma';
const recordLabels: readonly RecordLabel[] = ['alpha', 'beta', 'gamma'];

type ParityProjection = {
  readonly alias: string;
  readonly fieldId: string;
  readonly expression: string;
  readonly timeZone?: string;
};

const parityProjections: readonly ParityProjection[] = [
  { alias: 'userText', fieldId: stored.userText, expression: formulaText.userText },
  { alias: 'linkText', fieldId: stored.linkText, expression: formulaText.linkText },
  { alias: 'lookupMath', fieldId: stored.lookupMath, expression: formulaText.lookupMath },
  { alias: 'blankSum', fieldId: stored.blankSum, expression: formulaText.blankSum },
  { alias: 'blankNull', fieldId: stored.blankNull, expression: formulaText.blankNull },
  { alias: 'priceProduct', fieldId: stored.priceProduct, expression: formulaText.priceProduct },
  { alias: 'wideDouble', fieldId: stored.wideDouble, expression: formulaText.wideDouble },
  {
    alias: 'dueShanghai',
    fieldId: stored.dueShanghai,
    expression: formulaText.dueShanghai,
    timeZone: shanghai,
  },
  { alias: 'dueUtc', fieldId: stored.dueUtc, expression: formulaText.dueUtc, timeZone: utc },
  { alias: 'blankIsZero', fieldId: stored.blankIsZero, expression: formulaText.blankIsZero },
  { alias: 'blankPositive', fieldId: stored.blankPositive, expression: formulaText.blankPositive },
];

/**
 * Explicit expected values. Every scalar number here is exactly representable in
 * float8, so a double-precision formula result is compared without float noise;
 * blank numeric operands follow Teable arithmetic (`BLANK()` coerces to 0 inside
 * arithmetic, and `IF(0, ...)` is falsy).
 */
const expectedRows: Readonly<Record<RecordLabel, Readonly<Record<string, unknown>>>> = {
  alpha: {
    userText: 'alpha owner',
    linkText: 'peer alpha',
    lookupMath: 20,
    blankSum: 1,
    blankNull: null,
    priceProduct: 20.5,
    wideDouble: 2000000000001,
    dueShanghai: '2026-03-08 01:30',
    dueUtc: '2026-03-07 17:30',
    blankIsZero: true,
    blankPositive: false,
  },
  beta: {
    userText: null,
    linkText: null,
    lookupMath: 0,
    blankSum: 6,
    blankNull: 5,
    priceProduct: 0,
    wideDouble: 0,
    dueShanghai: '2026-03-09 00:45',
    dueUtc: '2026-03-08 16:45',
    blankIsZero: false,
    blankPositive: true,
  },
  gamma: {
    userText: 'beta owner',
    linkText: 'peer gamma',
    lookupMath: 12,
    blankSum: 1,
    blankNull: null,
    priceProduct: -10,
    wideDouble: -8,
    dueShanghai: '2026-03-09 10:15',
    dueUtc: '2026-03-09 02:15',
    blankIsZero: true,
    blankPositive: false,
  },
};

/**
 * v3 formula source expression: every `{token}` is a field id here, so the alias
 * map binds each alias to the field it actually names.
 */
const formulaExpression = (text: string, timeZone?: string): DataQueryFormulaExpression => {
  const references: Record<string, DataQueryFormulaReference> = {};
  for (const match of text.matchAll(/\{([^{}]+)\}/g)) {
    const alias = match[1];
    if (!alias) continue;
    references[alias] = { type: 'field', fieldId: alias };
  }
  return {
    type: 'formula',
    formula: text,
    references,
    ...(timeZone === undefined ? {} : { timeZone }),
  };
};

describe('stored computed formula parity with query formulas (PGlite)', () => {
  let testContainer: IV2NodeTestContainer;
  let commandBus: ICommandBus;
  let recordRepository: ITableRecordQueryRepository;
  let queryService: DataQueryService;
  let table: CreateTableResult['table'];
  let readContext: IExecutionContext;
  let records: Record<RecordLabel, CreateRecordResult['record']>;

  const storedFormulaValues = async (label: RecordLabel) => {
    const storedRecord = await recordRepository.findOne(readContext, table, records[label].id(), {
      mode: 'stored',
    });
    if (storedRecord.isErr()) {
      throw new Error(`stored read failed: ${JSON.stringify(storedRecord.error)}`);
    }
    const values = storedRecord.value.fields;
    return Object.fromEntries(
      parityProjections.map(({ alias, fieldId: projectedFieldId }) => [
        alias,
        values[projectedFieldId] ?? null,
      ])
    );
  };

  const buildRecordsQuery = (filter?: DataQueryPredicateV3) =>
    DataQueryDefinition.create({
      version: 3,
      kind: 'records',
      tableId: table.id().toString(),
      select: [
        { system: 'id', alias: 'id' },
        ...parityProjections.map(({ alias, expression, timeZone }) => ({
          expr: formulaExpression(expression, timeZone),
          alias,
        })),
      ],
      // Fixture labels define the expected order; generated IDs do not.
      sort: [{ fieldId: fields.title, order: 'asc' }],
      page: { limit: 10, includeTotal: true },
      ...(filter === undefined ? {} : { filter }),
    });

  const executeQuery = async (filter?: DataQueryPredicateV3) => {
    const definition = buildRecordsQuery(filter);
    if (definition.isErr()) {
      throw new Error(`query definition: ${JSON.stringify(definition.error)}`);
    }
    const executed = await queryService.execute(readContext, definition.value);
    if (executed.isErr()) throw new Error(`query execution: ${JSON.stringify(executed.error)}`);
    return executed.value;
  };

  const createOutputParityFixture = async (
    formulas: readonly { alias: string; expression: string; timeZone?: string }[],
    prefix = 'output'
  ) => {
    const source = {
      title: fieldId(`${prefix}Title`),
      done: fieldId(`${prefix}Done`),
      num: fieldId(`${prefix}Num`),
      date: fieldId(`${prefix}Date`),
    };
    const projections = formulas.map((formula) => ({
      ...formula,
      fieldId: fieldId(`out${formula.alias}`),
    }));
    const createTable = CreateTableCommand.create({
      baseId: testContainer.baseId.toString(),
      name: 'Physical formula output parity',
      fields: [
        { type: 'singleLineText', id: source.title, name: 'Title', isPrimary: true },
        { type: 'checkbox', id: source.done, name: 'Done' },
        { type: 'number', id: source.num, name: 'Num' },
        { type: 'date', id: source.date, name: 'Date' },
        ...projections.map(({ fieldId: id, alias, expression, timeZone }) => ({
          type: 'formula' as const,
          id,
          name: alias,
          options: { expression, ...(timeZone === undefined ? {} : { timeZone }) },
        })),
      ],
      views: [{ type: 'grid' }],
    });
    if (createTable.isErr()) {
      throw new Error(`output table command: ${JSON.stringify(createTable.error)}`);
    }
    const createdTable = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      readContext,
      createTable.value
    );
    if (createdTable.isErr()) {
      throw new Error(`output table execution: ${JSON.stringify(createdTable.error)}`);
    }
    const outputTable = createdTable.value.table;
    const inputs = [
      { title: 'Alpha', done: true, num: 30, date: '2026-03-06T02:15:00.000Z' },
      { title: 'Beta', done: true, num: 2, date: '2026-03-07T02:15:00.000Z' },
      { title: 'Gamma', done: false, num: 10, date: '2026-03-08T02:15:00.000Z' },
      { title: 'Omega', done: false, num: 4, date: '2026-03-09T02:15:00.000Z' },
    ];
    const rows: CreateRecordResult['record'][] = [];
    for (const input of inputs) {
      const record = (
        await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
          readContext,
          CreateRecordCommand.create({
            tableId: outputTable.id().toString(),
            fields: Object.fromEntries(
              Object.entries(source).map(([key, id]) => [id, input[key as keyof typeof input]])
            ),
          })._unsafeUnwrap()
        )
      )._unsafeUnwrap().record;
      rows.push(record);
    }
    await testContainer.processOutbox();
    const persisted: Record<string, unknown>[] = [];
    for (const row of rows) {
      const storedRow = (
        await recordRepository.findOne(readContext, outputTable, row.id(), { mode: 'stored' })
      )._unsafeUnwrap();
      persisted.push({
        id: row.id().toString(),
        ...Object.fromEntries(
          projections.map(({ alias, fieldId: id }) => {
            const value = storedRow.fields[id] ?? null;
            // Match HTTP JSON serialization, without parsing SQL timestamp text
            // or coercing non-Date values into the declared wire type.
            return [alias, value instanceof Date ? value.toISOString() : value];
          })
        ),
      });
    }
    for (const projection of projections) {
      const field = outputTable
        .getField((candidate) => candidate.id().toString() === projection.fieldId)
        ._unsafeUnwrap();
      if (!(field instanceof FormulaField)) throw new Error('Expected a stored formula field');
      expect(field.expression().toString()).toBe(projection.expression);
    }
    const definition = (sort?: { alias: string; order: 'asc' | 'desc' }) => {
      const parsed = DataQueryDefinition.create({
        version: 3,
        kind: 'records',
        tableId: outputTable.id().toString(),
        select: [
          { system: 'id', alias: 'id' },
          ...projections.map(({ alias, expression, timeZone }) => ({
            alias,
            expr: formulaExpression(expression, timeZone),
          })),
        ],
        sort: sort ? [sort] : [{ fieldId: source.title, order: 'asc' }],
      });
      if (parsed.isErr())
        throw new Error(`output query definition: ${JSON.stringify(parsed.error)}`);
      return parsed.value;
    };
    return { definition, persisted, rows };
  };

  it('matches persisted mixed IF and SWITCH domains, wire metadata and text alias sorting', async () => {
    const done = `{${fieldId('outputDone')}}`;
    const num = `{${fieldId('outputNum')}}`;
    const title = `{${fieldId('outputTitle')}}`;
    const date = `{${fieldId('outputDate')}}`;
    const mixed = [
      { alias: 'numText', expression: `IF(${done}, ${num}, ${title})` },
      { alias: 'textNum', expression: `IF(${done}, ${title}, ${num})` },
      { alias: 'boolText', expression: `IF(${done}, ${done}, ${title})` },
      { alias: 'textBool', expression: `IF(${done}, ${title}, ${done})` },
      { alias: 'dateText', expression: `IF(${done}, ${date}, ${title})` },
      { alias: 'textDate', expression: `IF(${done}, ${title}, ${date})` },
      { alias: 'switchNum', expression: `SWITCH(${done}, TRUE, ${num}, ${title})` },
      { alias: 'switchBool', expression: `SWITCH(${done}, TRUE, ${done}, ${title})` },
      { alias: 'switchDate', expression: `SWITCH(${done}, TRUE, ${date}, ${title})` },
    ];
    const controls = [
      { alias: 'numBlank', expression: `IF(${done}, ${num}, BLANK())` },
      { alias: 'lazyError', expression: `IF(${done}, ${title}, ERROR("branch"))` },
      { alias: 'lazyNumber', expression: `IF(${done}, ${num}, 1 / 0)` },
    ];
    const { definition, persisted, rows } = await createOutputParityFixture([
      ...mixed,
      ...controls,
    ]);
    const validated = await queryService.validate(readContext, definition());
    if (validated.isErr()) throw new Error(`mixed validation: ${JSON.stringify(validated.error)}`);
    expect(validated.value.outputs).toEqual([
      {
        alias: 'id',
        cellValueType: 'string',
        wireType: 'string',
        isMultipleCellValue: false,
        nullable: false,
      },
      ...[...mixed, ...controls].map(({ alias }) => ({
        alias,
        cellValueType: alias === 'numBlank' || alias === 'lazyNumber' ? 'number' : 'string',
        wireType: alias === 'numBlank' || alias === 'lazyNumber' ? 'numberOrString' : 'string',
        isMultipleCellValue: false,
        nullable: true,
      })),
    ]);
    const result = await queryService.execute(readContext, definition());
    if (result.isErr()) throw new Error(`mixed execution: ${JSON.stringify(result.error)}`);
    // Assert the real persisted oracle first: inferred String output is a physical
    // text cell even when its chosen SQL branch is numeric, boolean or datetime.
    expect(persisted.slice(0, 2).map((row) => row.numText)).toEqual(['30', '2']);
    expect(persisted.slice(2).map((row) => row.textNum)).toEqual(['10', '4']);
    expect(persisted.slice(0, 2).map((row) => row.boolText)).toEqual(['true', 'true']);
    expect(persisted.slice(2).map((row) => row.textBool)).toEqual(['false', 'false']);
    for (const row of persisted) {
      for (const { alias } of mixed) {
        if (row[alias] !== null) expect(typeof row[alias]).toBe('string');
      }
    }
    expect(persisted.map((row) => row.numBlank)).toEqual([30, 2, null, null]);
    expect(persisted.map((row) => row.lazyError)).toEqual([
      'Alpha',
      'Beta',
      '#ERROR: branch',
      '#ERROR: branch',
    ]);
    expect(persisted.map((row) => row.lazyNumber)).toEqual([30, 2, null, null]);
    expect(JSON.parse(JSON.stringify(result.value.rows))).toEqual(persisted);
    for (const order of ['asc', 'desc'] as const) {
      const sorted = (
        await queryService.execute(readContext, definition({ alias: 'numText', order }))
      )._unsafeUnwrap();
      const numericBranchIds = [rows[1]!, rows[0]!].map((row) => row.id().toString());
      expect(
        sorted.rows.map((row) => row.id).filter((id) => numericBranchIds.includes(String(id)))
      ).toEqual(order === 'asc' ? numericBranchIds : numericBranchIds.reverse());
    }
  });

  it('matches persisted WORKDAY timestamps across zero, positive, negative, weekend and holiday inputs', async () => {
    const date = `{${fieldId('workDate')}}`;
    const formulas = [
      { alias: 'workZero', expression: `WORKDAY(${date}, 0)` },
      { alias: 'workPositive', expression: `WORKDAY(${date}, 3)` },
      { alias: 'workNegative', expression: `WORKDAY(${date}, -3)` },
      { alias: 'workHoliday', expression: `WORKDAY(${date}, 3, "2026-03-10")` },
    ].map((formula) => ({ ...formula, timeZone: shanghai }));
    const { definition, persisted } = await createOutputParityFixture(formulas, 'work');
    const validated = (await queryService.validate(readContext, definition()))._unsafeUnwrap();
    expect(validated.outputs.slice(1)).toEqual(
      formulas.map(({ alias }) => ({
        alias,
        cellValueType: 'dateTime',
        wireType: 'string',
        isMultipleCellValue: false,
        nullable: true,
      }))
    );
    for (const row of persisted) {
      for (const { alias } of formulas) expect(row[alias]).toEqual(expect.any(String));
    }
    // Serialize Date objects as HTTP does, but do not reparse SQL timestamp text:
    // a driver interpreting a naive timestamp in process TZ still differs here.
    const executed = await queryService.execute(readContext, definition());
    if (executed.isErr()) throw new Error(`WORKDAY execution: ${JSON.stringify(executed.error)}`);
    expect(JSON.parse(JSON.stringify(executed.value.rows))).toEqual(persisted);
  });

  beforeAll(async () => {
    testContainer = await createV2NodeTestContainer({ logLevel: 'silent' });
    commandBus = testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    recordRepository = testContainer.container.resolve<ITableRecordQueryRepository>(
      v2CoreTokens.tableRecordQueryRepository
    );
    readContext = { actorId: ActorId.create('system')._unsafeUnwrap() };
    const baseId = testContainer.baseId.toString();

    // Collaborators of the base are the only users a user cell may resolve to.
    await testContainer.metaDb
      .insertInto('users')
      .values([
        { id: alphaUserId, name: 'Alpha Owner', email: sentinelEmail },
        { id: betaUserId, name: 'Beta Owner', email: 'beta.owner@synthetic.invalid' },
      ])
      .execute();
    await testContainer.metaDb
      .insertInto('collaborator')
      .values([
        {
          id: 'colparityalpha',
          resource_type: 'base',
          resource_id: baseId,
          principal_id: alphaUserId,
          principal_type: 'user',
        },
        {
          id: 'colparitybeta',
          resource_type: 'base',
          resource_id: baseId,
          principal_id: betaUserId,
          principal_type: 'user',
        },
      ])
      .execute();

    const createRecord = async (tableId: string, values: Record<string, unknown>) => {
      const command = CreateRecordCommand.create({ tableId, fields: values });
      if (command.isErr()) throw new Error(`create record: ${JSON.stringify(command.error)}`);
      const result = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        readContext,
        command.value
      );
      if (result.isErr()) throw new Error(`create record: ${JSON.stringify(result.error)}`);
      return result.value.record;
    };

    const foreignTable = (
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        readContext,
        CreateTableCommand.create({
          baseId,
          name: 'Parity peers',
          fields: [
            { type: 'singleLineText', id: fields.peerTitle, name: 'Peer name', isPrimary: true },
            { type: 'number', id: fields.peerScore, name: 'Peer score' },
          ],
          views: [{ type: 'grid' }],
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap().table;

    const peerAlpha = await createRecord(foreignTable.id().toString(), {
      [fields.peerTitle]: 'Peer Alpha',
      [fields.peerScore]: 10,
    });
    const peerGamma = await createRecord(foreignTable.id().toString(), {
      [fields.peerTitle]: 'Peer Gamma',
      [fields.peerScore]: 6,
    });

    table = (
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        readContext,
        CreateTableCommand.create({
          baseId,
          name: 'Parity host',
          fields: [
            { type: 'singleLineText', id: fields.title, name: 'Title', isPrimary: true },
            {
              type: 'user',
              id: fields.owner,
              name: 'Owner',
              options: { isMultiple: false, shouldNotify: false },
            },
            {
              type: 'link',
              id: fields.peer,
              name: 'Peer',
              options: {
                relationship: 'manyOne',
                foreignTableId: foreignTable.id().toString(),
                lookupFieldId: fields.peerTitle,
                isOneWay: true,
              },
            },
            {
              type: 'lookup',
              id: fields.score,
              name: 'Peer score',
              options: {
                linkFieldId: fields.peer,
                foreignTableId: foreignTable.id().toString(),
                lookupFieldId: fields.peerScore,
              },
            },
            { type: 'number', id: fields.blank, name: 'Blank number' },
            {
              type: 'number',
              id: fields.price,
              name: 'Price',
              options: { formatting: { type: 'decimal', precision: 2 } },
            },
            { type: 'number', id: fields.wide, name: 'Wide number' },
            {
              type: 'date',
              id: fields.due,
              name: 'Due',
              // Field formatting stays neutral: the formula's own declared zone must drive
              // DATETIME_FORMAT, so dueShanghai/dueUtc prove the formula time zone wins.
              options: { formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' } },
            },
            { type: 'number', id: fields.qty, name: 'Quantity' },
            ...parityProjections.map(({ fieldId: projectedFieldId, expression, timeZone }) => ({
              type: 'formula' as const,
              id: projectedFieldId,
              name: `Stored ${projectedFieldId}`,
              options: { expression, ...(timeZone === undefined ? {} : { timeZone }) },
            })),
          ],
          views: [{ type: 'grid' }],
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap().table;

    records = {
      alpha: await createRecord(table.id().toString(), {
        [fields.title]: 'Alpha',
        [fields.owner]: { id: alphaUserId },
        [fields.peer]: { id: peerAlpha.id().toString() },
        [fields.price]: 10.25,
        [fields.wide]: 1000000000000.5,
        [fields.due]: '2026-03-07T17:30:00.000Z',
        [fields.qty]: 2,
      }),
      beta: await createRecord(table.id().toString(), {
        [fields.title]: 'Beta',
        [fields.blank]: 5,
        [fields.due]: '2026-03-08T16:45:00.000Z',
        [fields.qty]: 3,
      }),
      gamma: await createRecord(table.id().toString(), {
        [fields.title]: 'Gamma',
        [fields.owner]: { id: betaUserId },
        [fields.peer]: { id: peerGamma.id().toString() },
        [fields.blank]: 0,
        [fields.price]: -2.5,
        [fields.wide]: -4,
        [fields.due]: '2026-03-09T02:15:00.000Z',
        [fields.qty]: 4,
      }),
    };

    // Persist every computed formula (and the lookup/link snapshots they read).
    await testContainer.processOutbox();

    queryService = new DataQueryService(
      testContainer.tableRepository,
      new RecordQueryPluginRunner([], new NoopLogger()),
      new PostgresDataQueryExecutor(testContainer.dataDb)
    );
  }, 180_000);

  afterAll(async () => {
    await testContainer?.dispose();
  });

  it('matches persisted values for user, link, lookup, blank, decimal, wide and zoned date formulas', async () => {
    const result = await executeQuery();
    expect(result.rows).toHaveLength(recordLabels.length);
    expect(result.page).toEqual({ limit: 10, offset: 0, total: recordLabels.length });

    // Both sides evaluate literally the same source string: the persisted formula
    // field's expression is the query projection text, not a re-serialized alias
    // translation of it.
    for (const projection of parityProjections) {
      const formulaField = table
        .getField((candidate) => candidate.id().toString() === projection.fieldId)
        ._unsafeUnwrap();
      if (!(formulaField instanceof FormulaField)) {
        throw new Error(`expected a stored formula field: ${projection.fieldId}`);
      }
      expect(formulaField.expression().toString()).toBe(projection.expression);
    }

    const rowsById = new Map(result.rows.map((row) => [String(row.id), row]));
    for (const label of recordLabels) {
      const id = records[label].id().toString();
      const expected = expectedRows[label];
      // Exact expected values: a wrong query result cannot pass.
      expect(rowsById.get(id)).toEqual({ id, ...expected });
      // Parity: the persisted computed row must carry the same values.
      expect(await storedFormulaValues(label)).toEqual(expected);
    }

    // The user cell snapshot persists the collaborator email; formula text output
    // must resolve the snapshot title instead of leaking the snapshot.
    expect(rowsById.get(records.alpha.id().toString())?.userText).toBe('alpha owner');
    expect((await storedFormulaValues('alpha')).userText).toBe('alpha owner');
    for (const label of recordLabels) {
      expect(String((await storedFormulaValues(label)).userText)).not.toContain(sentinelEmail);
    }
  });

  it('finalizes exact NUMERIC identities like stored formulas while preserving source and concatenated text', async () => {
    const titleId = fieldId('numericTitle');
    const examples = [
      {
        alias: 'decimal',
        sourceId: fieldId('preciseDecimal'),
        identityId: fieldId('decimalIdentity'),
        concatId: fieldId('decimalConcat'),
        exact: '9007199254740993.125',
      },
      {
        alias: 'integer',
        sourceId: fieldId('preciseInteger'),
        identityId: fieldId('integerIdentity'),
        concatId: fieldId('integerConcat'),
        exact: '9007199254740993',
      },
    ];
    let numericTable = (
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        readContext,
        CreateTableCommand.create({
          baseId: testContainer.baseId.toString(),
          name: 'Exact numeric parity',
          fields: [
            { type: 'singleLineText', id: titleId, name: 'Title', isPrimary: true },
            ...examples.map(({ alias, sourceId }) => ({
              type: 'number' as const,
              id: sourceId,
              name: `Exact ${alias}`,
            })),
          ],
          views: [{ type: 'grid' }],
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap().table;
    const numericRecord = (
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        readContext,
        CreateRecordCommand.create({
          tableId: numericTable.id().toString(),
          fields: { [titleId]: 'Exact source row' },
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap().record;

    const physical = numericTable.dbTableName()._unsafeUnwrap().split()._unsafeUnwrap();
    const tableSql = physical.schema
      ? sql.id(physical.schema, physical.tableName)
      : sql.id(physical.tableName);
    for (const example of examples) {
      const source = numericTable
        .getField((candidate) => candidate.id().toString() === example.sourceId)
        ._unsafeUnwrap();
      const column = source.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
      // Only source storage is seeded manually: JS numbers cannot represent these
      // exact inputs. No computed column or expected formula output is written.
      await sql`ALTER TABLE ${tableSql} ALTER COLUMN ${sql.id(column)}
        TYPE numeric USING ${sql.id(column)}::numeric`.execute(testContainer.dataDb);
      await sql`UPDATE ${tableSql} SET ${sql.id(column)} = ${example.exact}::numeric
        WHERE __id = ${numericRecord.id().toString()}`.execute(testContainer.dataDb);
    }

    // Creating formulas only after exact source data exists drives the real
    // formula backfill path; processOutbox, not the test, persists their values.
    const formulas = examples.flatMap((example) => [
      {
        alias: `${example.alias}Identity`,
        fieldId: example.identityId,
        expression: `{${example.sourceId}}`,
        expected: Number(example.exact),
      },
      {
        alias: `${example.alias}Concat`,
        fieldId: example.concatId,
        expression: `CONCATENATE({${example.sourceId}})`,
        expected: example.exact,
      },
    ]);
    for (const formula of formulas) {
      numericTable = (
        await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
          readContext,
          CreateFieldCommand.create({
            baseId: testContainer.baseId.toString(),
            tableId: numericTable.id().toString(),
            field: {
              type: 'formula',
              id: formula.fieldId,
              name: formula.alias,
              options: { expression: formula.expression },
            },
          })._unsafeUnwrap()
        )
      )._unsafeUnwrap().table;
    }
    await testContainer.processOutbox();

    const storedRow = (
      await recordRepository.findOne(readContext, numericTable, numericRecord.id(), {
        mode: 'stored',
      })
    )._unsafeUnwrap();
    const definition = DataQueryDefinition.create({
      version: 3,
      kind: 'records',
      tableId: numericTable.id().toString(),
      select: [
        { system: 'id', alias: 'id' },
        ...examples.map(({ alias, sourceId }) => ({
          fieldId: sourceId,
          alias: `${alias}Source`,
        })),
        ...formulas.map(({ alias, expression }) => ({
          alias,
          expr: formulaExpression(expression),
        })),
      ],
    })._unsafeUnwrap();
    const result = (await queryService.execute(readContext, definition))._unsafeUnwrap();
    const expectedRow: Record<string, unknown> = { id: numericRecord.id().toString() };
    const persistedRow: Record<string, unknown> = { id: storedRow.id };
    for (const { alias, sourceId, exact } of examples) {
      expectedRow[`${alias}Source`] = exact;
      persistedRow[`${alias}Source`] = storedRow.fields[sourceId];
      expect(storedRow.fields[sourceId]).toBe(exact);
    }
    for (const formula of formulas) {
      const storedField = numericTable
        .getField((candidate) => candidate.id().toString() === formula.fieldId)
        ._unsafeUnwrap();
      if (!(storedField instanceof FormulaField)) throw new Error('Expected a formula field');
      expect(storedField.expression().toString()).toBe(formula.expression);
      expectedRow[formula.alias] = formula.expected;
      persistedRow[formula.alias] = storedRow.fields[formula.fieldId];
      expect(storedRow.fields[formula.fieldId]).toBe(formula.expected);
    }
    // Identity formulas intentionally follow stored float8 semantics (rounded
    // number), whereas plain sources and CONCATENATE retain exact NUMERIC text.
    expect(result.rows).toEqual([expectedRow]);
    expect(result.rows).toEqual([persistedRow]);
  });

  it('reads a stored tracked LAST_MODIFIED_TIME formula by its persisted stamp after an unrelated change', async () => {
    const titleId = fieldId('lmtTitle');
    const trackedId = fieldId('lmtTracked');
    const unrelatedId = fieldId('lmtUnrelated');
    const trackedFormulaId = fieldId('lmtFormula');
    const trackedExpression = `LAST_MODIFIED_TIME({${trackedId}})`;

    const trackingTable = (
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        readContext,
        CreateTableCommand.create({
          baseId: testContainer.baseId.toString(),
          name: 'Tracked last modified parity',
          fields: [
            { type: 'singleLineText', id: titleId, name: 'Title', isPrimary: true },
            { type: 'number', id: trackedId, name: 'Tracked' },
            { type: 'singleLineText', id: unrelatedId, name: 'Unrelated' },
            {
              type: 'formula',
              id: trackedFormulaId,
              name: 'Tracked time',
              options: { expression: trackedExpression },
            },
          ],
          views: [{ type: 'grid' }],
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap().table;

    const trackedField = trackingTable
      .getField((candidate) => candidate.id().toString() === trackedFormulaId)
      ._unsafeUnwrap();
    if (!(trackedField instanceof FormulaField)) throw new Error('Expected a formula field');
    // Guard the fixture itself: the field under test must be the tracked LAST_MODIFIED_TIME
    // form, which is the shape the stored-preference path keys off.
    expect(trackedField.expression().toString()).toBe(trackedExpression);

    const trackedRecord = (
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        readContext,
        CreateRecordCommand.create({
          tableId: trackingTable.id().toString(),
          fields: { [titleId]: 'Tracked row', [trackedId]: 1, [unrelatedId]: 'before' },
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap().record;
    await testContainer.processOutbox();

    const readTrackingRow = async () => {
      const stored = await recordRepository.findOne(
        readContext,
        trackingTable,
        trackedRecord.id(),
        { mode: 'stored' }
      );
      if (stored.isErr()) throw new Error(`stored read failed: ${JSON.stringify(stored.error)}`);
      return stored.value;
    };

    const beforeChange = await readTrackingRow();
    const trackedStamp = beforeChange.fields[trackedFormulaId];
    expect(trackedStamp).toBeTruthy();

    const update = UpdateRecordCommand.create({
      tableId: trackingTable.id().toString(),
      recordId: trackedRecord.id().toString(),
      fields: { [unrelatedId]: 'after' },
    });
    if (update.isErr()) throw new Error(`update command: ${JSON.stringify(update.error)}`);
    const updated = await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
      readContext,
      update.value
    );
    if (updated.isErr()) throw new Error(`update failed: ${JSON.stringify(updated.error)}`);
    await testContainer.processOutbox();

    const afterChange = await readTrackingRow();
    // The tracked field never changed, so its persisted stamp must not move.
    expect(afterChange.fields[trackedFormulaId]).toEqual(trackedStamp);
    expect(afterChange.fields[unrelatedId]).toBe('after');

    const asIso = (value: unknown): string => {
      const date = value instanceof Date ? value : new Date(String(value));
      return date.toISOString();
    };
    const persistedStamp = asIso(trackedStamp);

    // Source-only clock fixture. The record's system row-time is what a zero-arg
    // LAST_MODIFIED_TIME() reads, so seeding it one day past the persisted stamp makes
    // "persisted tracker" and "fresh root clock" provably different without touching
    // the computed tracker column, sleeping, or faking a clock. This is source fixture
    // data, exactly like seeding a real NUMERIC source column above.
    const seededLastModified = new Date(
      new Date(persistedStamp).getTime() + 86_400_000
    ).toISOString();
    const physical = trackingTable.dbTableName()._unsafeUnwrap().split()._unsafeUnwrap();
    const physicalTable = physical.schema
      ? sql.id(physical.schema, physical.tableName)
      : sql.id(physical.tableName);
    await sql`UPDATE ${physicalTable}
      SET ${sql.id('__last_modified_time')} = ${seededLastModified}::timestamptz
      WHERE ${sql.id('__id')} = ${trackedRecord.id().toString()}`.execute(testContainer.dataDb);

    // The seed only moved a source system row value; the persisted tracker is untouched.
    expect((await readTrackingRow()).fields[trackedFormulaId]).toEqual(trackedStamp);

    const definition = DataQueryDefinition.create({
      version: 3,
      kind: 'records',
      tableId: trackingTable.id().toString(),
      select: [
        { system: 'id', alias: 'id' },
        { system: 'createdTime', alias: 'createdTime' },
        { system: 'lastModifiedTime', alias: 'rootLastModifiedTime' },
        { fieldId: trackedFormulaId, alias: 'plainSource' },
        { alias: 'byReference', expr: formulaExpression(`{${trackedFormulaId}}`) },
        { alias: 'zeroArgLastModifiedTime', expr: formulaExpression('LAST_MODIFIED_TIME()') },
      ],
      filter: { fieldId: titleId, operator: 'is', value: 'Tracked row' },
    })._unsafeUnwrap();
    const [row, ...extraRows] = (
      await queryService.execute(readContext, definition)
    )._unsafeUnwrap().rows;
    expect(extraRows).toHaveLength(0);
    if (!row) throw new Error('Expected the tracked row in the query result');

    // Both row-time readers must see the seeded source clock.
    expect(asIso(row.rootLastModifiedTime)).toBe(seededLastModified);
    expect(asIso(row.zeroArgLastModifiedTime)).toBe(seededLastModified);
    // The tracked formula was computed at creation and never moved: plain source reads
    // and the reference both answer with that persisted stamp, not the seeded clock.
    expect(asIso(row.createdTime)).toBe(persistedStamp);
    expect(asIso(row.plainSource)).toBe(persistedStamp);
    expect(asIso(row.byReference)).toBe(persistedStamp);
    expect(asIso(row.byReference)).not.toBe(asIso(row.rootLastModifiedTime));
    expect(asIso(row.plainSource)).not.toBe(asIso(row.zeroArgLastModifiedTime));
  });

  it('matches persisted boolean formulas for blank numeric comparisons through formula filters', async () => {
    const persisted = new Map<RecordLabel, Record<string, unknown>>();
    for (const label of recordLabels) persisted.set(label, await storedFormulaValues(label));

    const zeroIds: string[] = [];
    const positiveIds: string[] = [];
    for (const label of recordLabels) {
      const values = persisted.get(label);
      const id = records[label].id().toString();
      if (values?.blankIsZero === true) zeroIds.push(id);
      if (values?.blankPositive === true) positiveIds.push(id);
    }
    // Blank is zero for `= 0`, and only the actually-positive cell satisfies `> 0`.
    expect(zeroIds).toEqual([records.alpha.id().toString(), records.gamma.id().toString()]);
    expect(positiveIds).toEqual([records.beta.id().toString()]);

    const equalsZero = await executeQuery(formulaExpression(formulaText.blankIsZero));
    expect(equalsZero.rows.map((row) => String(row.id))).toEqual(zeroIds);
    expect(equalsZero.page).toMatchObject({ total: zeroIds.length });

    // A boolean formula leaf stays composable with legacy field leaves: the formula
    // matches alpha+gamma, the legacy leaf then prunes alpha.
    const mixed = await executeQuery({
      conjunction: 'and',
      items: [
        formulaExpression(formulaText.blankIsZero),
        { fieldId: fields.title, operator: 'isNot', value: 'Alpha' },
      ],
    });
    expect(mixed.rows.map((row) => String(row.id))).toEqual([records.gamma.id().toString()]);
    expect(mixed.page).toMatchObject({ total: 1 });

    // Negating the same formula leaf is the complement of the formula-matched set.
    const negated = await executeQuery({ not: formulaExpression(formulaText.blankIsZero) });
    expect(negated.rows.map((row) => String(row.id))).toEqual(positiveIds);
  });
});
