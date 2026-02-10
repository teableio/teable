import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  FieldValueTypeVisitor,
  FormulaConditionSpec,
  FormulaExpression,
  LinkFieldConfig,
  ok,
  RecordByIdsSpec,
  RecordConditionDateValue,
  RecordConditionLiteralListValue,
  RecordConditionLiteralValue,
  RecordId,
  RollupConditionSpec,
  RollupExpression,
  RollupFieldConfig,
  SelectOption,
  Table,
  TableId,
  TableName,
  UserMultiplicity,
  type RecordConditionOperator,
  type RecordConditionValue,
  type RollupField,
  resolveFormulaFields,
  Field,
} from '@teable/v2-core';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, describe, expect, test } from 'vitest';

import type { RecordConditionWhere } from './TableRecordConditionWhereVisitor';
import { TableRecordConditionWhereVisitor } from './TableRecordConditionWhereVisitor';

type FieldKey =
  | 'singleLineText'
  | 'longText'
  | 'button'
  | 'number'
  | 'rating'
  | 'checkbox'
  | 'date'
  | 'singleSelect'
  | 'multipleSelect'
  | 'attachment'
  | 'userSingle'
  | 'userMultiple'
  | 'linkSingle'
  | 'linkMultiple'
  | 'formula'
  | 'rollup';

type ConditionCase = {
  name: string;
  fieldKey: FieldKey;
  operator: RecordConditionOperator;
  value?: RecordConditionValue;
  expectError?: boolean;
};

const textValue = RecordConditionLiteralValue.create('hello')._unsafeUnwrap();
const numberValue = RecordConditionLiteralValue.create(42)._unsafeUnwrap();
const booleanValue = RecordConditionLiteralValue.create(true)._unsafeUnwrap();
const dateLiteralValue = RecordConditionLiteralValue.create(
  '2024-01-01T00:00:00.000Z'
)._unsafeUnwrap();
const listTextValue = RecordConditionLiteralListValue.create(['alpha', 'beta'])._unsafeUnwrap();
const listNumberValue = RecordConditionLiteralListValue.create([1, 2])._unsafeUnwrap();
const dateValue = RecordConditionDateValue.create({
  mode: 'exactDate',
  exactDate: '2024-01-01T00:00:00.000Z',
  timeZone: 'utc',
})._unsafeUnwrap();

const isEmptyOperator = (operator: RecordConditionOperator): boolean =>
  operator === 'isEmpty' || operator === 'isNotEmpty';

const listOperators = new Set<RecordConditionOperator>([
  'isAnyOf',
  'isNoneOf',
  'hasAnyOf',
  'hasAllOf',
  'isNotExactly',
  'hasNoneOf',
  'isExactly',
]);

const numericOperators = new Set<RecordConditionOperator>([
  'isGreater',
  'isGreaterEqual',
  'isLess',
  'isLessEqual',
]);

const dateOperators = new Set<RecordConditionOperator>([
  'isWithIn',
  'isBefore',
  'isAfter',
  'isOnOrBefore',
  'isOnOrAfter',
]);

const valueForTextOperator = (
  operator: RecordConditionOperator
): RecordConditionValue | undefined => (isEmptyOperator(operator) ? undefined : textValue);

const valueForNumberOperator = (
  operator: RecordConditionOperator
): RecordConditionValue | undefined => (isEmptyOperator(operator) ? undefined : numberValue);

const valueForDateOperator = (
  operator: RecordConditionOperator
): RecordConditionValue | undefined => {
  if (isEmptyOperator(operator)) return undefined;
  if (dateOperators.has(operator)) return dateValue;
  return dateLiteralValue;
};

const valueForSingleSelectOperator = (
  operator: RecordConditionOperator
): RecordConditionValue | undefined => {
  if (isEmptyOperator(operator)) return undefined;
  if (listOperators.has(operator)) return listTextValue;
  return textValue;
};

const valueForMultipleSelectOperator = (
  operator: RecordConditionOperator
): RecordConditionValue | undefined => (isEmptyOperator(operator) ? undefined : listTextValue);

const valueForUserSingleOperator = (
  operator: RecordConditionOperator
): RecordConditionValue | undefined => {
  if (isEmptyOperator(operator)) return undefined;
  if (listOperators.has(operator)) return listTextValue;
  return textValue;
};

const valueForUserMultipleOperator = (
  operator: RecordConditionOperator
): RecordConditionValue | undefined => (isEmptyOperator(operator) ? undefined : listTextValue);

const valueForLinkSingleOperator = (
  operator: RecordConditionOperator
): RecordConditionValue | undefined => {
  if (isEmptyOperator(operator)) return undefined;
  if (listOperators.has(operator)) return listTextValue;
  return textValue;
};

const valueForLinkMultipleOperator = (
  operator: RecordConditionOperator
): RecordConditionValue | undefined => {
  if (isEmptyOperator(operator)) return undefined;
  if (listOperators.has(operator)) return listTextValue;
  return textValue;
};

const valueForFormulaOperator = (
  operator: RecordConditionOperator
): RecordConditionValue | undefined => {
  if (isEmptyOperator(operator)) return undefined;
  if (dateOperators.has(operator)) return dateValue;
  if (numericOperators.has(operator)) return numberValue;
  if (listOperators.has(operator)) return listNumberValue;
  if (operator === 'contains' || operator === 'doesNotContain') return textValue;
  return numberValue;
};

const valueForRollupOperator = (
  operator: RecordConditionOperator
): RecordConditionValue | undefined => {
  if (isEmptyOperator(operator)) return undefined;
  if (dateOperators.has(operator)) return dateValue;
  if (numericOperators.has(operator)) return numberValue;
  if (listOperators.has(operator)) return listNumberValue;
  if (operator === 'contains' || operator === 'doesNotContain') return textValue;
  return numberValue;
};

const buildCases = (
  fieldKey: FieldKey,
  operators: ReadonlyArray<RecordConditionOperator>,
  valueForOperator: (operator: RecordConditionOperator) => RecordConditionValue | undefined,
  errorOperators: ReadonlyArray<RecordConditionOperator> = []
): ConditionCase[] =>
  operators.map((operator) => ({
    name: `${fieldKey}:${operator}`,
    fieldKey,
    operator,
    value: valueForOperator(operator),
    expectError: errorOperators.includes(operator),
  }));

const textOperators: RecordConditionOperator[] = [
  'is',
  'isNot',
  'contains',
  'doesNotContain',
  'isEmpty',
  'isNotEmpty',
];

const numberOperators: RecordConditionOperator[] = [
  'is',
  'isNot',
  'isGreater',
  'isGreaterEqual',
  'isLess',
  'isLessEqual',
  'isEmpty',
  'isNotEmpty',
];

const dateConditionOperators: RecordConditionOperator[] = [
  'is',
  'isNot',
  'isWithIn',
  'isBefore',
  'isAfter',
  'isOnOrBefore',
  'isOnOrAfter',
  'isEmpty',
  'isNotEmpty',
];

const singleSelectOperators: RecordConditionOperator[] = [
  'is',
  'isNot',
  'isAnyOf',
  'isNoneOf',
  'isEmpty',
  'isNotEmpty',
];

const multipleSelectOperators: RecordConditionOperator[] = [
  'hasAnyOf',
  'hasAllOf',
  'isExactly',
  'isNotExactly',
  'hasNoneOf',
  'isEmpty',
  'isNotEmpty',
];

const attachmentOperators: RecordConditionOperator[] = ['isEmpty', 'isNotEmpty'];

const userSingleOperators: RecordConditionOperator[] = [
  'is',
  'isNot',
  'isAnyOf',
  'isNoneOf',
  'isEmpty',
  'isNotEmpty',
];

const userMultipleOperators: RecordConditionOperator[] = [
  'hasAnyOf',
  'hasAllOf',
  'isExactly',
  'isNotExactly',
  'hasNoneOf',
  'isEmpty',
  'isNotEmpty',
];

const linkSingleOperators: RecordConditionOperator[] = [
  'is',
  'isNot',
  'isAnyOf',
  'isNoneOf',
  'contains',
  'doesNotContain',
  'isEmpty',
  'isNotEmpty',
];

const linkMultipleOperators: RecordConditionOperator[] = [
  'hasAnyOf',
  'hasAllOf',
  'isExactly',
  'isNotExactly',
  'hasNoneOf',
  'contains',
  'doesNotContain',
  'isEmpty',
  'isNotEmpty',
];

const recordOperators: RecordConditionOperator[] = [
  'is',
  'isNot',
  'contains',
  'doesNotContain',
  'isEmpty',
  'isNotEmpty',
  'isGreater',
  'isGreaterEqual',
  'isLess',
  'isLessEqual',
  'isAnyOf',
  'isNoneOf',
  'hasAnyOf',
  'hasAllOf',
  'isNotExactly',
  'hasNoneOf',
  'isExactly',
  'isWithIn',
  'isBefore',
  'isAfter',
  'isOnOrBefore',
  'isOnOrAfter',
];

const cases: ConditionCase[] = [
  ...buildCases('singleLineText', textOperators, valueForTextOperator),
  ...buildCases('longText', textOperators, valueForTextOperator),
  ...buildCases('button', textOperators, valueForTextOperator),
  ...buildCases('number', numberOperators, valueForNumberOperator),
  ...buildCases('rating', numberOperators, valueForNumberOperator),
  ...buildCases('checkbox', ['is'], () => booleanValue),
  ...buildCases('date', dateConditionOperators, valueForDateOperator),
  ...buildCases('singleSelect', singleSelectOperators, valueForSingleSelectOperator),
  ...buildCases('multipleSelect', multipleSelectOperators, valueForMultipleSelectOperator),
  ...buildCases('attachment', attachmentOperators, () => undefined),
  ...buildCases('userSingle', userSingleOperators, valueForUserSingleOperator),
  ...buildCases('userMultiple', userMultipleOperators, valueForUserMultipleOperator),
  ...buildCases('linkSingle', linkSingleOperators, valueForLinkSingleOperator),
  ...buildCases('linkMultiple', linkMultipleOperators, valueForLinkMultipleOperator),
  ...buildCases('formula', recordOperators, valueForFormulaOperator),
  ...buildCases('rollup', recordOperators, valueForRollupOperator),
];

const createQueryCompiler = (): Kysely<unknown> =>
  new Kysely({
    dialect: new PostgresDialect({
      pool: async () => new Pool({ connectionString: 'postgres://localhost:5432/postgres' }),
    }),
  });

const compileCondition = (db: Kysely<unknown>, condition: RecordConditionWhere) => {
  const compiled = condition.compile(db);
  return {
    sql: compiled.sql,
    parameters: compiled.parameters,
  };
};

const buildFixture = (): { fields: Record<FieldKey, Field> } => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Conditions')._unsafeUnwrap();
  const selectOptions = [
    SelectOption.create({ name: 'Todo', color: 'blue' })._unsafeUnwrap(),
    SelectOption.create({ name: 'Done', color: 'red' })._unsafeUnwrap(),
  ];

  const linkSingleId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();
  const linkMultipleId = FieldId.create(`fld${'m'.repeat(16)}`)._unsafeUnwrap();
  const foreignTableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const lookupFieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();

  const linkSingleConfig = LinkFieldConfig.create({
    relationship: 'manyOne',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: lookupFieldId.toString(),
  })._unsafeUnwrap();
  const linkMultipleConfig = LinkFieldConfig.create({
    relationship: 'manyMany',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: lookupFieldId.toString(),
  })._unsafeUnwrap();

  const rollupConfig = RollupFieldConfig.create({
    linkFieldId: linkSingleId.toString(),
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: lookupFieldId.toString(),
  })._unsafeUnwrap();
  const rollupExpression = RollupExpression.default();

  const builder = Table.builder().withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  builder.field().longText().withName(FieldName.create('Description')._unsafeUnwrap()).done();
  builder.field().button().withName(FieldName.create('Action')._unsafeUnwrap()).done();
  builder.field().number().withName(FieldName.create('Amount')._unsafeUnwrap()).done();
  builder.field().rating().withName(FieldName.create('Rating')._unsafeUnwrap()).done();
  builder.field().checkbox().withName(FieldName.create('Done')._unsafeUnwrap()).done();
  builder.field().date().withName(FieldName.create('Due Date')._unsafeUnwrap()).done();
  builder
    .field()
    .singleSelect()
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .withOptions(selectOptions)
    .done();
  builder
    .field()
    .multipleSelect()
    .withName(FieldName.create('Tags')._unsafeUnwrap())
    .withOptions(selectOptions)
    .done();
  builder.field().attachment().withName(FieldName.create('Files')._unsafeUnwrap()).done();
  builder.field().user().withName(FieldName.create('Owner')._unsafeUnwrap()).done();
  builder
    .field()
    .user()
    .withName(FieldName.create('Collaborators')._unsafeUnwrap())
    .withMultiplicity(UserMultiplicity.multiple())
    .done();
  builder
    .field()
    .link()
    .withId(linkSingleId)
    .withName(FieldName.create('Related')._unsafeUnwrap())
    .withConfig(linkSingleConfig)
    .done();
  builder
    .field()
    .link()
    .withId(linkMultipleId)
    .withName(FieldName.create('Related Many')._unsafeUnwrap())
    .withConfig(linkMultipleConfig)
    .done();
  builder
    .field()
    .formula()
    .withName(FieldName.create('Score')._unsafeUnwrap())
    .withExpression(FormulaExpression.create('1')._unsafeUnwrap())
    .done();
  builder
    .field()
    .rollup()
    .withName(FieldName.create('Rollup')._unsafeUnwrap())
    .withConfig(rollupConfig)
    .withExpression(rollupExpression)
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  resolveFormulaFields(table)._unsafeUnwrap();

  const fields = {
    singleLineText: table.getField((field) => field.name().toString() === 'Title')._unsafeUnwrap(),
    longText: table.getField((field) => field.name().toString() === 'Description')._unsafeUnwrap(),
    button: table.getField((field) => field.name().toString() === 'Action')._unsafeUnwrap(),
    number: table.getField((field) => field.name().toString() === 'Amount')._unsafeUnwrap(),
    rating: table.getField((field) => field.name().toString() === 'Rating')._unsafeUnwrap(),
    checkbox: table.getField((field) => field.name().toString() === 'Done')._unsafeUnwrap(),
    date: table.getField((field) => field.name().toString() === 'Due Date')._unsafeUnwrap(),
    singleSelect: table.getField((field) => field.name().toString() === 'Status')._unsafeUnwrap(),
    multipleSelect: table.getField((field) => field.name().toString() === 'Tags')._unsafeUnwrap(),
    attachment: table.getField((field) => field.name().toString() === 'Files')._unsafeUnwrap(),
    userSingle: table.getField((field) => field.name().toString() === 'Owner')._unsafeUnwrap(),
    userMultiple: table
      .getField((field) => field.name().toString() === 'Collaborators')
      ._unsafeUnwrap(),
    linkSingle: table.getField((field) => field.name().toString() === 'Related')._unsafeUnwrap(),
    linkMultiple: table
      .getField((field) => field.name().toString() === 'Related Many')
      ._unsafeUnwrap(),
    formula: table.getField((field) => field.name().toString() === 'Score')._unsafeUnwrap(),
    rollup: table.getField((field) => field.name().toString() === 'Rollup')._unsafeUnwrap(),
  } satisfies Record<FieldKey, Field>;

  const dbFieldNames: Record<FieldKey, string> = {
    singleLineText: 'col_title',
    longText: 'col_description',
    button: 'col_action',
    number: 'col_amount',
    rating: 'col_rating',
    checkbox: 'col_done',
    date: 'col_due_date',
    singleSelect: 'col_status',
    multipleSelect: 'col_tags',
    attachment: 'col_files',
    userSingle: 'col_owner',
    userMultiple: 'col_collaborators',
    linkSingle: 'col_related',
    linkMultiple: 'col_related_many',
    formula: 'col_score',
    rollup: 'col_rollup',
  };

  (Object.entries(dbFieldNames) as Array<[FieldKey, string]>).forEach(([key, value]) => {
    fields[key].setDbFieldName(DbFieldName.rehydrate(value)._unsafeUnwrap())._unsafeUnwrap();
  });

  const rollupField = fields.rollup as RollupField;
  const valuesType = fields.number.accept(new FieldValueTypeVisitor())._unsafeUnwrap();
  rollupField.resolveResultType(valuesType)._unsafeUnwrap();

  return { fields };
};

const db = createQueryCompiler();
const fixture = buildFixture();

afterAll(async () => {
  await db.destroy();
});

describe('TableRecordConditionWhereVisitor', () => {
  test.each(cases)('builds SQL for $name', ({ fieldKey, operator, value, expectError }) => {
    const field = fixture.fields[fieldKey];
    const specResult =
      fieldKey === 'formula'
        ? ok(FormulaConditionSpec.create(field, operator, value))
        : fieldKey === 'rollup'
          ? ok(RollupConditionSpec.create(field, operator, value))
          : field.spec().create({ operator, value });
    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) return;

    const spec = specResult.value;
    const visitor = new TableRecordConditionWhereVisitor();
    const visitResult = spec.accept(visitor);

    if (expectError) {
      expect(visitResult.isErr()).toBe(true);
      expect(visitResult._unsafeUnwrapErr().message).toMatchSnapshot();
      return;
    }

    expect(visitResult.isOk()).toBe(true);
    const where = visitor.where()._unsafeUnwrap();
    const compiled = compileCondition(db, where);

    expect(compiled).toMatchSnapshot();
  });

  test('builds SQL for record id list', () => {
    const recordIds = [RecordId.generate()._unsafeUnwrap(), RecordId.generate()._unsafeUnwrap()];
    const spec = RecordByIdsSpec.create(recordIds);
    const visitor = new TableRecordConditionWhereVisitor();
    const visitResult = spec.accept(visitor);

    expect(visitResult.isOk()).toBe(true);
    const where = visitor.where()._unsafeUnwrap();
    const compiled = compileCondition(db, where);

    expect(compiled.sql.toLowerCase()).toContain('in');
    expect(compiled.sql).toContain('__id');
    expect(compiled.parameters).toEqual(recordIds.map((id) => id.toString()));
  });
});
