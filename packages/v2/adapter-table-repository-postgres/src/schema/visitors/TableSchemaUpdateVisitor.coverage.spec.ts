import {
  DbFieldName,
  FieldId,
  FieldNotNull,
  FieldUnique,
  RatingMax,
  SelectOption,
  TableUpdateFieldConstraintsSpec,
  TableUpdateFieldDbFieldNameSpec,
  UpdateMultipleSelectOptionsSpec,
  UpdateRatingMaxSpec,
  UpdateSingleSelectOptionsSpec,
  UpdateUserMultiplicitySpec,
  UserMultiplicity,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { TableSchemaUpdateVisitor } from './TableSchemaUpdateVisitor';
import {
  createBtnField,
  createTestDb,
  createTextField,
  createValidFieldId,
} from './__tests__/helpers';

const db = createTestDb();
const SCHEMA = 'bseTableSchemaTest';
const TABLE_NAME = 'tblVisitorCoverage';

const mkFieldId = (seed: string) => FieldId.create(createValidFieldId(seed))._unsafeUnwrap();
const mkDbFieldName = (name: string) => DbFieldName.rehydrate(name)._unsafeUnwrap();
const normalizeSql = (sql: string) => sql.replace(/\s+/g, ' ').trim();

const createVisitor = (table: unknown = {}) =>
  new TableSchemaUpdateVisitor({
    db,
    schema: SCHEMA,
    tableName: TABLE_NAME,
    tableId: TABLE_NAME,
    table: table as never,
  });

const expectEmptyStatements = (
  result: ReturnType<TableSchemaUpdateVisitor['visitTableRename']>
) => {
  expect(result.isOk()).toBe(true);
  expect(result._unsafeUnwrap()).toEqual([]);
};

describe('TableSchemaUpdateVisitor coverage', () => {
  it('covers metadata-only methods that intentionally return empty statements', () => {
    const visitor = createVisitor();
    const emptyMethods = [
      'visitTableRename',
      'visitTableAddSelectOptions',
      'visitTableUpdateFieldAiConfig',
      'visitTableUpdateFieldDescription',
      'visitUpdateSingleLineTextShowAs',
      'visitUpdateSingleLineTextDefaultValue',
      'visitUpdateLongTextShowAs',
      'visitUpdateLongTextDefaultValue',
      'visitUpdateNumberFormatting',
      'visitUpdateNumberShowAs',
      'visitUpdateNumberDefaultValue',
      'visitUpdateDateFormatting',
      'visitUpdateDateDefaultValue',
      'visitUpdateCheckboxDefaultValue',
      'visitUpdateRatingIcon',
      'visitUpdateRatingColor',
      'visitUpdateUserNotification',
      'visitUpdateUserDefaultValue',
      'visitUpdateButtonLabel',
      'visitUpdateButtonColor',
      'visitUpdateButtonMaxCount',
      'visitUpdateSingleSelectDefaultValue',
      'visitUpdateSingleSelectAutoNewOptions',
      'visitUpdateMultipleSelectDefaultValue',
      'visitUpdateMultipleSelectAutoNewOptions',
      'visitUpdateFormulaFormatting',
      'visitUpdateFormulaShowAs',
      'visitUpdateFormulaTimeZone',
      'visitUpdateLinkConfig',
      'visitUpdateLookupOptions',
      'visitUpdateRollupConfig',
      'visitUpdateRollupExpression',
      'visitUpdateRollupFormatting',
      'visitUpdateRollupShowAs',
      'visitUpdateRollupTimeZone',
      'visitTableByName',
      'visitTableUpdateFieldName',
    ] as const;

    for (const method of emptyMethods) {
      expectEmptyStatements(
        (visitor[method] as (spec: unknown) => ReturnType<typeof visitor.visitTableRename>)({})
      );
    }
  });

  it('returns validation errors for unsupported search specs', () => {
    const visitor = createVisitor();
    const errorMethods = [
      'visitTableByBaseId',
      'visitTableById',
      'visitTableByIncomingReferenceToTable',
      'visitTableByIds',
      'visitTableByNameLike',
    ] as const;

    for (const method of errorMethods) {
      const result = (
        visitor[method] as (spec: unknown) => ReturnType<typeof visitor.visitTableById>
      )({});
      expect(result.isErr()).toBe(true);
    }
  });

  it('generates ALTER TABLE statements for constraint changes and no-op for unchanged constraints', () => {
    const fieldId = mkFieldId('constraints');
    const spec = TableUpdateFieldConstraintsSpec.create({
      fieldId,
      dbFieldName: mkDbFieldName('constraint_col'),
      previousNotNull: FieldNotNull.optional(),
      nextNotNull: FieldNotNull.required(),
      previousUnique: FieldUnique.disabled(),
      nextUnique: FieldUnique.enabled(),
    });
    const visitor = createVisitor();
    const result = visitor.visitTableUpdateFieldConstraints(spec);

    expect(result.isOk()).toBe(true);
    const sqls = result._unsafeUnwrap().map((statement) => normalizeSql(statement.compile(db).sql));
    expect(sqls).toHaveLength(2);
    expect(sqls[0]).toContain(
      'ALTER TABLE "bseTableSchemaTest"."tblVisitorCoverage" ALTER COLUMN "constraint_col" SET NOT NULL'
    );
    expect(sqls[1]).toContain(
      'ADD CONSTRAINT "tblVisitorCoverage_constraint_col_unique" UNIQUE ("constraint_col")'
    );

    const noChange = TableUpdateFieldConstraintsSpec.create({
      fieldId,
      dbFieldName: mkDbFieldName('constraint_col'),
      previousNotNull: FieldNotNull.optional(),
      nextNotNull: FieldNotNull.optional(),
      previousUnique: FieldUnique.disabled(),
      nextUnique: FieldUnique.disabled(),
    });
    expectEmptyStatements(visitor.visitTableUpdateFieldConstraints(noChange));
  });

  it('renames db columns and the related trigram index', () => {
    const fieldId = mkFieldId('renameDb');
    const spec = TableUpdateFieldDbFieldNameSpec.create(
      fieldId,
      mkDbFieldName('old_name'),
      mkDbFieldName('new_name')
    );
    const visitor = createVisitor();
    const result = visitor.visitTableUpdateFieldDbFieldName(spec);

    expect(result.isOk()).toBe(true);
    const sqls = result._unsafeUnwrap().map((statement) => normalizeSql(statement.compile(db).sql));
    expect(sqls[0]).toContain(
      'ALTER TABLE "bseTableSchemaTest"."tblVisitorCoverage" RENAME COLUMN "old_name" TO "new_name"'
    );
    expect(sqls[1]).toContain('ALTER INDEX IF EXISTS');
    expect(sqls[1]).toContain('RENAME TO');
  });

  it('clamps rating values only when the max decreases', () => {
    const fieldId = mkFieldId('rating');
    const reducingSpec = UpdateRatingMaxSpec.create(
      fieldId,
      mkDbFieldName('rating_col'),
      RatingMax.create(5)._unsafeUnwrap(),
      RatingMax.create(3)._unsafeUnwrap()
    );
    const visitor = createVisitor();
    const reducing = visitor.visitUpdateRatingMax(reducingSpec);

    expect(reducing.isOk()).toBe(true);
    const sql = normalizeSql(reducing._unsafeUnwrap()[0].compile(db).sql);
    expect(sql).toContain(
      'UPDATE "bseTableSchemaTest"."tblVisitorCoverage" SET "rating_col" = $1 WHERE "rating_col" > $2'
    );

    const increasingSpec = UpdateRatingMaxSpec.create(
      fieldId,
      mkDbFieldName('rating_col'),
      RatingMax.create(3)._unsafeUnwrap(),
      RatingMax.create(5)._unsafeUnwrap()
    );
    expectEmptyStatements(visitor.visitUpdateRatingMax(increasingSpec));
  });

  it('rewrites user field storage between single and multiple jsonb shapes', () => {
    const fieldId = mkFieldId('users');
    const visitor = createVisitor();

    const toMultiple = visitor.visitUpdateUserMultiplicity(
      UpdateUserMultiplicitySpec.create(
        fieldId,
        mkDbFieldName('user_col'),
        UserMultiplicity.single(),
        UserMultiplicity.multiple()
      )
    );
    expect(toMultiple.isOk()).toBe(true);
    expect(normalizeSql(toMultiple._unsafeUnwrap()[0].compile(db).sql)).toContain(
      'SET "user_col" = jsonb_build_array("user_col") WHERE "user_col" IS NOT NULL'
    );

    const toSingle = visitor.visitUpdateUserMultiplicity(
      UpdateUserMultiplicitySpec.create(
        fieldId,
        mkDbFieldName('user_col'),
        UserMultiplicity.multiple(),
        UserMultiplicity.single()
      )
    );
    expect(toSingle.isOk()).toBe(true);
    expect(normalizeSql(toSingle._unsafeUnwrap()[0].compile(db).sql)).toContain(
      'SET "user_col" = ("user_col"->0) WHERE "user_col" IS NOT NULL AND jsonb_array_length("user_col") > 0'
    );

    expectEmptyStatements(
      visitor.visitUpdateUserMultiplicity(
        UpdateUserMultiplicitySpec.create(
          fieldId,
          mkDbFieldName('user_col'),
          UserMultiplicity.single(),
          UserMultiplicity.single()
        )
      )
    );
  });

  it('updates single-select and multi-select stored option values', () => {
    const optA = SelectOption.create({
      id: 'choA11111111',
      name: 'A',
      color: 'red',
    })._unsafeUnwrap();
    const optARenamed = SelectOption.create({
      id: 'choA11111111',
      name: 'A2',
      color: 'red',
    })._unsafeUnwrap();
    const optB = SelectOption.create({
      id: 'choB22222222',
      name: 'B',
      color: 'blue',
    })._unsafeUnwrap();
    const fieldId = mkFieldId('selects');
    const visitor = createVisitor();

    const singleResult = visitor.visitUpdateSingleSelectOptions(
      UpdateSingleSelectOptionsSpec.create(
        fieldId,
        mkDbFieldName('single_sel'),
        [optA, optB],
        [optARenamed]
      )
    );
    expect(singleResult.isOk()).toBe(true);
    const singleSqls = singleResult
      ._unsafeUnwrap()
      .map((statement) => normalizeSql(statement.compile(db).sql));
    expect(singleSqls[0]).toContain('SET "single_sel" = $1 WHERE "single_sel" = $2');
    expect(singleSqls[1]).toContain('SET "single_sel" = NULL WHERE "single_sel" = $1');

    const multiResult = visitor.visitUpdateMultipleSelectOptions(
      UpdateMultipleSelectOptionsSpec.create(
        fieldId,
        mkDbFieldName('multi_sel'),
        [optA, optB],
        [optARenamed]
      )
    );
    expect(multiResult.isOk()).toBe(true);
    const multiSqls = multiResult
      ._unsafeUnwrap()
      .map((statement) => normalizeSql(statement.compile(db).sql));
    expect(multiSqls[0]).toContain('jsonb_array_elements_text("multi_sel")');
    expect(multiSqls[0]).toContain('value = $1 THEN $2 ELSE value END');
    expect(multiSqls[1]).toContain('WHERE value <> $1');
  });

  it('clears persisted button values when workflow changes', () => {
    const buttonField = createBtnField('buttonField', 'Button', 'button_col')._unsafeUnwrap();
    const visitor = createVisitor({
      getField: () => ok(buttonField),
    });
    const result = visitor.visitUpdateButtonWorkflow({
      fieldId: () => buttonField.id(),
    } as never);

    expect(result.isOk()).toBe(true);
    expect(normalizeSql(result._unsafeUnwrap()[0].compile(db).sql)).toContain(
      'UPDATE "bseTableSchemaTest"."tblVisitorCoverage" SET "button_col" = NULL WHERE "button_col" IS NOT NULL'
    );
  });

  it('drops only the symmetric jsonb column during link teardown', () => {
    const textField = createTextField('symField', 'Symmetric', 'sym_col')._unsafeUnwrap();
    const visitor = createVisitor();
    const result = visitor.visitRemoveSymmetricLinkField({
      field: () => textField,
    } as never);

    expect(result.isOk()).toBe(true);
    expect(normalizeSql(result._unsafeUnwrap()[0].compile(db).sql)).toContain(
      'ALTER TABLE "bseTableSchemaTest"."tblVisitorCoverage" DROP COLUMN IF EXISTS "sym_col"'
    );
  });
});
