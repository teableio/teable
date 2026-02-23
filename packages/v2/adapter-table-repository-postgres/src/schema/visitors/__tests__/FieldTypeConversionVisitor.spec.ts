/**
 * Unit tests for FieldTypeConversionVisitor using SQL snapshots.
 *
 * These tests validate the SQL statements generated for field type conversions
 * using Kysely DummyDriver (no actual database connection).
 */
import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  type LinkField,
  FormulaExpression,
  LinkFieldConfig,
  LinkRelationship,
  TableId,
  createLinkField,
  createFormulaField,
  createAutoNumberField,
  createCreatedTimeField,
  createLastModifiedTimeField,
  CellValueType,
  CellValueMultiplicity,
  DateTimeFormatting,
  DateFormattingPreset,
  TimeFormatting,
  TimeZone,
} from '@teable/v2-core';
import type { Field } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import {
  FieldTypeConversionVisitorFactory,
  generateFieldConversionStatements,
  type FieldConversionParams,
} from '../FieldTypeConversionVisitor';
import { createTestDb } from './helpers/createTestDb';
import {
  createTextField,
  createNumField,
  createRatField,
  createCheckField,
  createDtField,
  createSingleSelField,
  createMultiSelField,
  createUsrField,
  createAttField,
  createBtnField,
  createValidFieldId,
} from './helpers/fieldFactories';

// Reusable test database (DummyDriver, no real connection)
const db = createTestDb();

// Common conversion params
const SCHEMA = 'bseTestBase000000001';
const TABLE_NAME = 'tblTestTable0000001';
const TABLE_ID = 'tblTestTable0000001';
const DB_FIELD_NAME = 'fld_test_col';
const FIELD_ID = createValidFieldId('optGen');

const createParams = (overrides?: Partial<FieldConversionParams>): FieldConversionParams => ({
  db: db as never,
  schema: SCHEMA,
  tableName: TABLE_NAME,
  tableId: TABLE_ID,
  dbFieldName: DB_FIELD_NAME,
  fieldId: FIELD_ID,
  ...overrides,
});

/**
 * Helper: Given source + target fields, run generateFieldConversionStatements
 * and return compiled SQL strings.
 */
const getConversionSqls = (sourceField: Field, targetField: Field): string[] => {
  const params = createParams();
  const result = generateFieldConversionStatements(params, sourceField, targetField);
  expect(result.isOk()).toBe(true);
  const statements = result._unsafeUnwrap();
  return statements.map((s) => s.compile(db as never).sql);
};

/**
 * Helper: Given a source field, create a conversion visitor via the factory,
 * then visit the target field and return compiled SQL strings.
 */
const getVisitorSqls = (sourceField: Field, targetField: Field): string[] => {
  const params = createParams();
  const factory = new FieldTypeConversionVisitorFactory(params);
  const visitorResult = sourceField.accept(factory);
  expect(visitorResult.isOk()).toBe(true);
  const visitor = visitorResult._unsafeUnwrap();
  const statementsResult = targetField.accept(visitor);
  expect(statementsResult.isOk()).toBe(true);
  const statements = statementsResult._unsafeUnwrap();
  return statements.map((s) => s.compile(db as never).sql);
};

// ----- Field factory helpers -----

const mkTextField = () => createTextField('srcText', 'Source Text', DB_FIELD_NAME)._unsafeUnwrap();
const mkNumField = () => createNumField('tgtNum', 'Target Number', DB_FIELD_NAME)._unsafeUnwrap();
const mkRatField = (max = 5) =>
  createRatField('tgtRat', 'Target Rating', DB_FIELD_NAME, max)._unsafeUnwrap();
const mkCheckField = () =>
  createCheckField('tgtChk', 'Target Checkbox', DB_FIELD_NAME)._unsafeUnwrap();
const mkDateField = () => createDtField('tgtDt', 'Target Date', DB_FIELD_NAME)._unsafeUnwrap();
const mkSingleSelField = () =>
  createSingleSelField('tgtSel', 'Target SingleSel', DB_FIELD_NAME)._unsafeUnwrap();
const mkMultiSelField = () =>
  createMultiSelField('tgtMsel', 'Target MultiSel', DB_FIELD_NAME)._unsafeUnwrap();
const mkUsrField = (isMultiple = false) =>
  createUsrField('tgtUsr', 'Target User', DB_FIELD_NAME, isMultiple)._unsafeUnwrap();
const mkAttField = () =>
  createAttField('tgtAtt', 'Target Attachment', DB_FIELD_NAME)._unsafeUnwrap();
const mkBtnField = () => createBtnField('tgtBtn', 'Target Button', DB_FIELD_NAME)._unsafeUnwrap();

// Source fields (when used as the "from" type)
const mkSrcCheckField = () =>
  createCheckField('srcChk', 'Source Checkbox', DB_FIELD_NAME)._unsafeUnwrap();
const mkSrcNumField = () =>
  createNumField('srcNum', 'Source Number', DB_FIELD_NAME)._unsafeUnwrap();
const mkSrcDateField = () => createDtField('srcDt', 'Source Date', DB_FIELD_NAME)._unsafeUnwrap();
const mkSrcMultiSelField = () =>
  createMultiSelField('srcMsel', 'Source MultiSel', DB_FIELD_NAME)._unsafeUnwrap();
const mkSrcUsrField = (isMultiple = false) =>
  createUsrField('srcUsr', 'Source User', DB_FIELD_NAME, isMultiple)._unsafeUnwrap();
const mkSrcRatField = (max = 5) =>
  createRatField('srcRat', 'Source Rating', DB_FIELD_NAME, max)._unsafeUnwrap();

// Helper for creating FieldId/FieldName for computed field tests
const mkFieldId = (seed: string) => FieldId.create(createValidFieldId(seed))._unsafeUnwrap();
const mkFieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();
const mkManyOneLinkField = () =>
  (() => {
    const field = createLinkField({
      id: mkFieldId('tgtLink'),
      name: mkFieldName('Target Link'),
      config: LinkFieldConfig.create({
        relationship: LinkRelationship.manyOne().toString(),
        foreignTableId: `tbl${'b'.repeat(16)}`,
        lookupFieldId: createValidFieldId('lookFk'),
      })._unsafeUnwrap(),
    })._unsafeUnwrap() as LinkField;
    field
      .ensureDbConfig({
        baseId: BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap(),
        hostTableId: TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap(),
      })
      ._unsafeUnwrap();
    field.setDbFieldName(DbFieldName.rehydrate(DB_FIELD_NAME)._unsafeUnwrap())._unsafeUnwrap();
    return field;
  })();

const mkManyOneLinkFieldWithSymmetric = () =>
  (() => {
    const field = createLinkField({
      id: mkFieldId('tgtLinkSym'),
      name: mkFieldName('Target Link Sym'),
      config: LinkFieldConfig.create({
        relationship: LinkRelationship.manyOne().toString(),
        foreignTableId: `tbl${'b'.repeat(16)}`,
        lookupFieldId: createValidFieldId('lookFkSym'),
        symmetricFieldId: createValidFieldId('symFk01'),
      })._unsafeUnwrap(),
    })._unsafeUnwrap() as LinkField;
    field
      .ensureDbConfig({
        baseId: BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap(),
        hostTableId: TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap(),
      })
      ._unsafeUnwrap();
    field.setDbFieldName(DbFieldName.rehydrate(DB_FIELD_NAME)._unsafeUnwrap())._unsafeUnwrap();
    return field;
  })();

const mkManyOneLinkFieldWithForeign = (fieldSeed: string, foreignTableId: string) =>
  (() => {
    const field = createLinkField({
      id: mkFieldId(fieldSeed),
      name: mkFieldName(`Link ${fieldSeed}`),
      config: LinkFieldConfig.create({
        relationship: LinkRelationship.manyOne().toString(),
        foreignTableId,
        lookupFieldId: createValidFieldId(`look${fieldSeed}`),
      })._unsafeUnwrap(),
    })._unsafeUnwrap() as LinkField;
    field
      .ensureDbConfig({
        baseId: BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap(),
        hostTableId: TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap(),
      })
      ._unsafeUnwrap();
    field.setDbFieldName(DbFieldName.rehydrate(DB_FIELD_NAME)._unsafeUnwrap())._unsafeUnwrap();
    return field;
  })();

describe('FieldTypeConversionVisitor', () => {
  describe('TextFieldConversionVisitor', () => {
    describe('text -> number', () => {
      it('should generate SQL to parse numeric strings and set NULL for invalid values', () => {
        const sqls = getVisitorSqls(mkTextField(), mkNumField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('ALTER TABLE');
        expect(sqls[0]).toContain('TYPE double precision');
        expect(sqls[0]).toContain('CASE WHEN');
        expect(sqls[0]).toContain('ELSE NULL END');
      });

      it('should handle decimal numbers correctly', () => {
        const sqls = getVisitorSqls(mkTextField(), mkNumField());
        // Regex pattern should include decimal point handling
        expect(sqls[0]).toContain('\\.[0-9]+');
      });

      it('should handle negative numbers correctly', () => {
        const sqls = getVisitorSqls(mkTextField(), mkNumField());
        // Regex pattern should include negative sign handling
        expect(sqls[0]).toContain('-?');
      });
    });

    describe('text -> rating', () => {
      it('should generate SQL to parse and clamp values to max rating', () => {
        const sqls = getVisitorSqls(mkTextField(), mkRatField(5));
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('GREATEST(0');
        expect(sqls[0]).toContain('LEAST(FLOOR');
      });

      it('should respect the rating max from field configuration', () => {
        const sqls3 = getVisitorSqls(mkTextField(), mkRatField(3));
        expect(sqls3[0]).toContain('3');

        const sqls10 = getVisitorSqls(mkTextField(), mkRatField(10));
        expect(sqls10[0]).toContain('10');
      });
    });

    describe('text -> checkbox', () => {
      it('should generate SQL to convert non-empty text to TRUE', () => {
        const sqls = getVisitorSqls(mkTextField(), mkCheckField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('CASE WHEN');
        expect(sqls[0]).toContain('IS NOT NULL');
        expect(sqls[0]).toContain('TRUE');
      });

      it('should generate SQL that sets empty strings to NULL', () => {
        const sqls = getVisitorSqls(mkTextField(), mkCheckField());
        expect(sqls[0]).toContain("<> ''");
      });

      it('should set NULL for unrecognized string patterns', () => {
        const sqls = getVisitorSqls(mkTextField(), mkCheckField());
        expect(sqls[0]).toContain('ELSE NULL END');
      });
    });

    describe('text -> date', () => {
      it('should generate SQL to parse ISO date strings', () => {
        const sqls = getVisitorSqls(mkTextField(), mkDateField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('TYPE timestamptz');
        expect(sqls[0]).toContain('::timestamptz');
      });

      it('should set NULL for invalid date strings', () => {
        const sqls = getVisitorSqls(mkTextField(), mkDateField());
        expect(sqls[0]).toContain('ELSE NULL END');
        // Regex checks for ISO date pattern
        expect(sqls[0]).toMatch(/\\d\{4\}.*\\d\{2\}.*\\d\{2\}/);
      });
    });

    describe('text -> singleSelect', () => {
      it('should generate SQL to auto-populate options from distinct values', () => {
        const sqls = getVisitorSqls(mkTextField(), mkSingleSelField());
        // With fieldId set, should include the options generation CTE
        expect(sqls.length).toBeGreaterThanOrEqual(1);
        const optionsSql = sqls[0];
        expect(optionsSql).toContain('distinct_values');
        expect(optionsSql).toContain('DISTINCT');
        expect(optionsSql).toContain('UPDATE field');
      });

      it('should not generate type conversion statement (same DB type)', () => {
        const sqls = getVisitorSqls(mkTextField(), mkSingleSelField());
        // Text -> SingleSelect is same DB type, no ALTER COLUMN TYPE
        const hasAlterType = sqls.some((s) => s.includes('ALTER TABLE') && s.includes('TYPE'));
        expect(hasAlterType).toBe(false);
      });
    });

    describe('text -> multipleSelect', () => {
      it('should generate CSV-aware SQL to split text into jsonb array (V1 parity)', () => {
        const sqls = getVisitorSqls(mkTextField(), mkMultiSelField());
        // Should use regexp_matches with CSV-aware pattern instead of regexp_split_to_table
        const updateSql = sqls.find((s) => s.includes('regexp_matches'));
        expect(updateSql).toBeDefined();
        expect(updateSql).toContain('jsonb_agg');
        expect(updateSql).toContain('COALESCE(trim(m[1]), trim(m[2]))');
        const alterSql = sqls.find((s) => s.includes('TYPE jsonb'));
        expect(alterSql).toBeDefined();
      });

      it('should generate SQL to auto-populate options from distinct CSV-aware split values', () => {
        const sqls = getVisitorSqls(mkTextField(), mkMultiSelField());
        const optionsSql = sqls.find((s) => s.includes('distinct_values'));
        expect(optionsSql).toBeDefined();
        expect(optionsSql).toContain('DISTINCT');
        expect(optionsSql).toContain('regexp_matches');
        expect(optionsSql).toContain('COALESCE(trim(m[1]), trim(m[2]))');
      });
    });

    describe('text -> user', () => {
      it('should generate SQL to match text against collaborators by id, name, or email', () => {
        const sqls = getVisitorSqls(mkTextField(), mkUsrField(false));
        expect(sqls.length).toBeGreaterThanOrEqual(2);
        // First statement is the DO block for user matching
        const matchSql = sqls[0];
        expect(matchSql).toContain('collab_users');
        expect(matchSql).toContain('matched_users');
      });

      it('should generate SQL for single user format (object)', () => {
        const sqls = getVisitorSqls(mkTextField(), mkUsrField(false));
        const matchSql = sqls[0];
        expect(matchSql).toContain('jsonb_build_object');
      });

      it('should generate SQL for multiple user format (array of objects)', () => {
        const sqls = getVisitorSqls(mkTextField(), mkUsrField(true));
        const matchSql = sqls[0];
        expect(matchSql).toContain('jsonb_agg');
      });
    });

    describe('text -> attachment', () => {
      it('should generate SQL to set all values to NULL (incompatible)', () => {
        const sqls = getVisitorSqls(mkTextField(), mkAttField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('TYPE jsonb');
        expect(sqls[0]).toContain('USING NULL');
      });
    });

    describe('text -> button', () => {
      it('should generate SQL to set all values to NULL (incompatible)', () => {
        const sqls = getVisitorSqls(mkTextField(), mkBtnField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('TYPE jsonb');
        expect(sqls[0]).toContain('USING NULL');
      });
    });
  });

  describe('NumberFieldConversionVisitor', () => {
    describe('number -> text', () => {
      it('should generate SQL with simple cast to text', () => {
        const sqls = getVisitorSqls(mkSrcNumField(), mkTextField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('TYPE text');
        expect(sqls[0]).toContain('::text');
      });
    });

    describe('rating -> text', () => {
      it('should not force two-decimal formatting when converting rating to text', () => {
        const sqls = getVisitorSqls(mkSrcRatField(), mkTextField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('TYPE text');
        expect(sqls[0]).toContain('::numeric');
        expect(sqls[0]).not.toContain('round(');
      });
    });

    describe('number -> rating', () => {
      it('should generate SQL to clamp values to rating max', () => {
        const sqls = getVisitorSqls(mkSrcNumField(), mkRatField(5));
        expect(sqls).toHaveLength(1);
        const sql = sqls[0];
        expect(sql).toContain('UPDATE');
        expect(sql).toContain('GREATEST(0');
        expect(sql).toContain('LEAST(FLOOR');
        expect(sql).toContain('$1');
      });
    });

    describe('number -> checkbox', () => {
      it('should generate SQL where 0 becomes FALSE and non-zero becomes TRUE', () => {
        const sqls = getVisitorSqls(mkSrcNumField(), mkCheckField());
        expect(sqls).toHaveLength(1);
        const sql = sqls[0];
        expect(sql).toContain('TYPE boolean');
        expect(sql).toContain('CASE WHEN');
        expect(sql).toContain('= 0 THEN FALSE');
        expect(sql).toContain('IS NOT NULL THEN TRUE');
        expect(sql).toContain('ELSE NULL END');
      });
    });

    describe('number -> date', () => {
      it('should generate SQL to convert Unix timestamp (milliseconds) to timestamptz', () => {
        const sqls = getVisitorSqls(mkSrcNumField(), mkDateField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('TYPE timestamptz');
        expect(sqls[0]).toContain('to_timestamp');
        expect(sqls[0]).toContain('/ 1000');
      });
    });

    describe('number -> singleSelect', () => {
      it('should generate SQL to auto-populate options before type conversion', () => {
        const sqls = getVisitorSqls(mkSrcNumField(), mkSingleSelField());
        // First statement is options generation, second is ALTER to text
        expect(sqls.length).toBeGreaterThanOrEqual(2);
        expect(sqls[0]).toContain('distinct_values');
      });

      it('should generate SQL to cast number to text', () => {
        const sqls = getVisitorSqls(mkSrcNumField(), mkSingleSelField());
        const alterSql = sqls.find((s) => s.includes('TYPE text'));
        expect(alterSql).toBeDefined();
      });
    });

    describe('number -> multipleSelect', () => {
      it('should generate SQL to wrap number as text in jsonb array', () => {
        const sqls = getVisitorSqls(mkSrcNumField(), mkMultiSelField());
        const alterSql = sqls.find((s) => s.includes('TYPE jsonb'));
        expect(alterSql).toBeDefined();
        expect(alterSql).toContain('jsonb_build_array');
        expect(alterSql).toContain('::text');
      });
    });
  });

  describe('CheckboxFieldConversionVisitor', () => {
    describe('checkbox -> text', () => {
      it("should generate SQL to convert TRUE to 'true' and FALSE to 'false'", () => {
        const sqls = getVisitorSqls(mkSrcCheckField(), mkTextField());
        expect(sqls).toHaveLength(1);
        const sql = sqls[0];
        expect(sql).toContain('TYPE text');
        expect(sql).toContain("= TRUE THEN 'true'");
        expect(sql).toContain("= FALSE THEN 'false'");
        expect(sql).toContain('ELSE NULL END');
      });
    });

    describe('checkbox -> number', () => {
      it('should generate SQL to convert TRUE to 1 and FALSE to 0', () => {
        const sqls = getVisitorSqls(mkSrcCheckField(), mkNumField());
        expect(sqls).toHaveLength(1);
        const sql = sqls[0];
        expect(sql).toContain('TYPE double precision');
        expect(sql).toContain('= TRUE THEN 1');
        expect(sql).toContain('= FALSE THEN 0');
        expect(sql).toContain('ELSE NULL END');
      });
    });

    describe('checkbox -> rating', () => {
      it('should generate SQL to convert TRUE to max rating and FALSE to 0', () => {
        const sqls = getVisitorSqls(mkSrcCheckField(), mkRatField(5));
        expect(sqls).toHaveLength(1);
        const sql = sqls[0];
        expect(sql).toContain('TYPE double precision');
        expect(sql).toContain('= TRUE THEN 5');
        expect(sql).toContain('= FALSE THEN 0');
        expect(sql).toContain('ELSE NULL END');
      });

      it('should use the correct max value for different rating configurations', () => {
        const sqls = getVisitorSqls(mkSrcCheckField(), mkRatField(10));
        expect(sqls[0]).toContain('= TRUE THEN 10');
      });
    });

    describe('checkbox -> date', () => {
      it('should generate SQL to set all values to NULL (incompatible)', () => {
        const sqls = getVisitorSqls(mkSrcCheckField(), mkDateField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('TYPE timestamptz');
        expect(sqls[0]).toContain('USING NULL');
      });
    });

    describe('checkbox -> singleSelect', () => {
      it("should generate SQL to convert to 'true'/'false' text", () => {
        const sqls = getVisitorSqls(mkSrcCheckField(), mkSingleSelField());
        const alterSql = sqls.find((s) => s.includes('TYPE text'));
        expect(alterSql).toBeDefined();
        expect(alterSql).toContain("= TRUE THEN 'true'");
        expect(alterSql).toContain("= FALSE THEN 'false'");
      });

      it('should generate SQL to auto-populate options', () => {
        const sqls = getVisitorSqls(mkSrcCheckField(), mkSingleSelField());
        const optionsSql = sqls.find((s) => s.includes('distinct_values'));
        expect(optionsSql).toBeDefined();
      });
    });

    describe('checkbox -> multipleSelect', () => {
      it("should generate SQL to convert to ['true'] or ['false'] jsonb array", () => {
        const sqls = getVisitorSqls(mkSrcCheckField(), mkMultiSelField());
        const alterSql = sqls.find((s) => s.includes('TYPE jsonb'));
        expect(alterSql).toBeDefined();
        expect(alterSql).toContain('["true"]');
        expect(alterSql).toContain('["false"]');
      });
    });
  });

  describe('DateFieldConversionVisitor', () => {
    describe('date -> text', () => {
      it('should generate SQL to cast to text (ISO format)', () => {
        const sqls = getVisitorSqls(mkSrcDateField(), mkTextField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('TYPE text');
        expect(sqls[0]).toContain('::text');
      });
    });

    describe('date -> number', () => {
      it('should generate SQL to convert date to Unix timestamp milliseconds', () => {
        const sqls = getVisitorSqls(mkSrcDateField(), mkNumField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('TYPE double precision');
        expect(sqls[0]).toContain('extract(epoch from');
        expect(sqls[0]).toContain('* 1000');
      });
    });

    describe('date -> checkbox', () => {
      it('should generate SQL where non-null date becomes TRUE', () => {
        const sqls = getVisitorSqls(mkSrcDateField(), mkCheckField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('TYPE boolean');
        expect(sqls[0]).toContain('IS NOT NULL THEN TRUE');
        expect(sqls[0]).toContain('ELSE NULL END');
      });
    });

    describe('date -> singleSelect', () => {
      it('should generate SQL to cast to text and auto-populate options', () => {
        const sqls = getVisitorSqls(mkSrcDateField(), mkSingleSelField());
        // Options generation + ALTER to text
        const optionsSql = sqls.find((s) => s.includes('distinct_values'));
        expect(optionsSql).toBeDefined();
        const alterSql = sqls.find((s) => s.includes('TYPE text'));
        expect(alterSql).toBeDefined();
      });
    });

    describe('date -> multipleSelect', () => {
      it('should generate SQL to wrap date text in jsonb array', () => {
        const sqls = getVisitorSqls(mkSrcDateField(), mkMultiSelField());
        const alterSql = sqls.find((s) => s.includes('TYPE jsonb'));
        expect(alterSql).toBeDefined();
        expect(alterSql).toContain('jsonb_build_array');
        expect(alterSql).toContain('::text');
      });
    });
  });

  describe('MultipleSelectFieldConversionVisitor', () => {
    describe('multipleSelect -> text', () => {
      it('should generate SQL to join array elements with comma', () => {
        const sqls = getVisitorSqls(mkSrcMultiSelField(), mkTextField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('TYPE text');
        expect(sqls[0]).toContain('btrim');
        expect(sqls[0]).toContain('replace');
      });
    });

    describe('multipleSelect -> singleSelect', () => {
      it('should generate SQL to extract first element', () => {
        const sqls = getVisitorSqls(mkSrcMultiSelField(), mkSingleSelField());
        const alterSql = sqls.find((s) => s.includes('TYPE text'));
        expect(alterSql).toBeDefined();
        expect(alterSql).toContain('->>0');
      });
    });

    describe('multipleSelect -> checkbox', () => {
      it('should generate SQL where non-empty array becomes TRUE', () => {
        const sqls = getVisitorSqls(mkSrcMultiSelField(), mkCheckField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('TYPE boolean');
        expect(sqls[0]).toContain('jsonb_array_length');
        expect(sqls[0]).toContain('> 0 THEN TRUE');
      });
    });

    describe('multipleSelect -> number', () => {
      it('should generate SQL to set all values to NULL (incompatible)', () => {
        const sqls = getVisitorSqls(mkSrcMultiSelField(), mkNumField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('TYPE double precision');
        expect(sqls[0]).toContain('USING NULL');
      });
    });

    describe('multipleSelect -> date', () => {
      it('should generate SQL to set all values to NULL (incompatible)', () => {
        const sqls = getVisitorSqls(mkSrcMultiSelField(), mkDateField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('TYPE timestamptz');
        expect(sqls[0]).toContain('USING NULL');
      });
    });
  });

  describe('UserFieldConversionVisitor', () => {
    describe('user -> text', () => {
      it('should generate SQL to extract user title/email/id', () => {
        const sqls = getVisitorSqls(mkSrcUsrField(), mkTextField());
        expect(sqls.length).toBeGreaterThanOrEqual(2);
        // First statement transforms user to text payload
        const updateSql = sqls[0];
        expect(updateSql).toContain('COALESCE');
        expect(updateSql).toContain("->>'title'");
        expect(updateSql).toContain("->>'email'");
        expect(updateSql).toContain("->>'id'");
      });

      it('should generate SQL to join multiple users with comma', () => {
        const sqls = getVisitorSqls(mkSrcUsrField(), mkTextField());
        const updateSql = sqls[0];
        expect(updateSql).toContain('string_agg');
        expect(updateSql).toContain('jsonb_typeof');
        expect(updateSql).toContain("'array'");
      });
    });

    describe('user -> checkbox', () => {
      it('should generate SQL where user object becomes TRUE', () => {
        const sqls = getVisitorSqls(mkSrcUsrField(), mkCheckField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('TYPE boolean');
        expect(sqls[0]).toContain('jsonb_typeof');
        expect(sqls[0]).toContain("'object' THEN TRUE");
      });

      it('should generate SQL where non-empty user array becomes TRUE', () => {
        const sqls = getVisitorSqls(mkSrcUsrField(), mkCheckField());
        expect(sqls[0]).toContain("'array'");
        expect(sqls[0]).toContain('jsonb_array_length');
        expect(sqls[0]).toContain('> 0 THEN TRUE');
      });
    });

    describe('user -> singleSelect', () => {
      it('should generate SQL to extract first user title', () => {
        const sqls = getVisitorSqls(mkSrcUsrField(), mkSingleSelField());
        const alterSql = sqls.find((s) => s.includes('TYPE text'));
        expect(alterSql).toBeDefined();
        expect(alterSql).toContain("->>'v'");
      });

      it('should generate SQL to auto-populate options from user titles', () => {
        const sqls = getVisitorSqls(mkSrcUsrField(), mkSingleSelField());
        const optionsSql = sqls.find((s) => s.includes('distinct_values'));
        expect(optionsSql).toBeDefined();
      });
    });

    describe('user -> multipleSelect', () => {
      it('should generate SQL to extract user titles as string array', () => {
        const sqls = getVisitorSqls(mkSrcUsrField(), mkMultiSelField());
        const updateSql = sqls.find((s) => s.includes('UPDATE'));
        expect(updateSql).toBeDefined();
        expect(updateSql).toContain('jsonb_agg');
        expect(updateSql).toContain("->>'title'");
      });
    });

    describe('user multiplicity changes (single<->multiple)', () => {
      it('should generate SQL to wrap single user in array (single -> multiple)', () => {
        const sqls = getVisitorSqls(mkSrcUsrField(false), mkUsrField(true));
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('TYPE jsonb');
        expect(sqls[0]).toContain('jsonb_typeof');
        expect(sqls[0]).toContain("'object' THEN jsonb_build_array");
      });

      it('should generate SQL to extract first user from array (multiple -> single)', () => {
        const sqls = getVisitorSqls(mkSrcUsrField(true), mkUsrField(false));
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('TYPE jsonb');
        expect(sqls[0]).toContain("'array'");
        expect(sqls[0]).toContain('->0');
      });

      it('should preserve existing format if already correct', () => {
        // single -> multiple: arrays pass through as-is
        const sqls = getVisitorSqls(mkSrcUsrField(false), mkUsrField(true));
        expect(sqls[0]).toContain("'array' THEN");
      });
    });
  });

  describe('FieldTypeConversionVisitorFactory', () => {
    const params = createParams();
    const factory = new FieldTypeConversionVisitorFactory(params);

    it('should return a visitor for singleLineText field', () => {
      const result = mkTextField().accept(factory);
      expect(result.isOk()).toBe(true);
    });

    it('should return a visitor for number field', () => {
      const result = mkSrcNumField().accept(factory);
      expect(result.isOk()).toBe(true);
    });

    it('should return a visitor for rating field (same as number)', () => {
      const result = mkSrcRatField().accept(factory);
      expect(result.isOk()).toBe(true);
    });

    it('should return a visitor for checkbox field', () => {
      const result = mkSrcCheckField().accept(factory);
      expect(result.isOk()).toBe(true);
    });

    it('should return a visitor for date field', () => {
      const result = mkSrcDateField().accept(factory);
      expect(result.isOk()).toBe(true);
    });

    it('should return a visitor for multipleSelect field', () => {
      const result = mkSrcMultiSelField().accept(factory);
      expect(result.isOk()).toBe(true);
    });

    it('should return a visitor for singleSelect field', () => {
      const result = createSingleSelField('srcSel', 'Source Sel', DB_FIELD_NAME)
        ._unsafeUnwrap()
        .accept(factory);
      expect(result.isOk()).toBe(true);
    });

    it('should return a visitor for user field', () => {
      const result = mkSrcUsrField().accept(factory);
      expect(result.isOk()).toBe(true);
    });

    it('should return a visitor for attachment field', () => {
      const result = mkAttField().accept(factory);
      expect(result.isOk()).toBe(true);
    });

    it('should return a visitor for button field', () => {
      const result = mkBtnField().accept(factory);
      expect(result.isOk()).toBe(true);
    });

    it('should return error for formula field (computed field)', () => {
      const expression = FormulaExpression.create('1 + 1')._unsafeUnwrap();
      const formulaField = createFormulaField({
        id: mkFieldId('fmlFact'),
        name: mkFieldName('Formula'),
        expression,
      })._unsafeUnwrap();

      const result = formulaField.accept(factory);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('formula');
    });

    it('should return error for autoNumber field', () => {
      const autoField = createAutoNumberField({
        id: mkFieldId('autoNum'),
        name: mkFieldName('AutoNum'),
      })._unsafeUnwrap();

      const result = autoField.accept(factory);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('auto number');
    });

    it('should return error for createdTime field', () => {
      const field = createCreatedTimeField({
        id: mkFieldId('crtTime'),
        name: mkFieldName('Created'),
      })._unsafeUnwrap();

      const result = field.accept(factory);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('created time');
    });

    it('should return error for lastModifiedTime field', () => {
      const field = createLastModifiedTimeField({
        id: mkFieldId('lmTime'),
        name: mkFieldName('Modified'),
      })._unsafeUnwrap();

      const result = field.accept(factory);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('last modified time');
    });
  });

  describe('generateFieldConversionStatements', () => {
    describe('ALTER-based conversion cases', () => {
      it('should use conversion visitor for text -> number', () => {
        const sqls = getConversionSqls(mkTextField(), mkNumField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('ALTER TABLE');
        expect(sqls[0]).toContain('TYPE double precision');
      });

      it('should use conversion visitor for checkbox -> text', () => {
        const sqls = getConversionSqls(mkSrcCheckField(), mkTextField());
        expect(sqls).toHaveLength(1);
        expect(sqls[0]).toContain('ALTER TABLE');
        expect(sqls[0]).toContain('TYPE text');
        expect(sqls[0]).toContain("'true'");
        expect(sqls[0]).toContain("'false'");
      });

      it('should return empty array for text -> text (no conversion)', () => {
        const srcText = mkTextField();
        const tgtText = createTextField('tgtText', 'Target Text', DB_FIELD_NAME)._unsafeUnwrap();
        const sqls = getConversionSqls(srcText, tgtText);
        expect(sqls).toHaveLength(0);
      });

      it('should return empty array for checkbox -> checkbox (no conversion)', () => {
        const srcChk = mkSrcCheckField();
        const tgtChk = mkCheckField();
        const sqls = getConversionSqls(srcChk, tgtChk);
        expect(sqls).toHaveLength(0);
      });

      it('should return empty array for number -> number (no conversion)', () => {
        const srcNum = mkSrcNumField();
        const tgtNum = mkNumField();
        const sqls = getConversionSqls(srcNum, tgtNum);
        expect(sqls).toHaveLength(0);
      });

      it('should return empty array for date -> date (no conversion)', () => {
        const srcDt = mkSrcDateField();
        const tgtDt = mkDateField();
        const sqls = getConversionSqls(srcDt, tgtDt);
        expect(sqls).toHaveLength(0);
      });
    });

    describe('schema recreation cases', () => {
      it('should split scalar source by comma for text -> manyOne link mapping', () => {
        const sqls = getConversionSqls(mkTextField(), mkManyOneLinkField());
        const mappingSql = sqls.find((sql) => sql.includes('DO $v2_link_map$'));
        expect(mappingSql).toBeDefined();
        expect(mappingSql).toContain('string_to_array');
        expect(mappingSql).toContain('trim(part)');
        expect(mappingSql).toContain('DISTINCT ON (source_id)');
        expect(mappingSql).toContain('ORDER BY source_id, part_idx');
        expect(mappingSql).toContain('p.part_idx');
      });

      it('should backfill symmetric oneMany json values for manyOne conversion', () => {
        const sqls = getConversionSqls(mkTextField(), mkManyOneLinkFieldWithSymmetric());
        const mappingSql = sqls.find((sql) => sql.includes('DO $v2_link_map$'));
        expect(mappingSql).toBeDefined();
        expect(mappingSql).toContain('symmetric_col');
        expect(mappingSql).toContain('jsonb_agg(jsonb_build_object');
        expect(mappingSql).toContain('WHERE f."__id" = src.foreign_id');
      });

      it('should preserve title-based mapping for link -> link when foreign table changes', () => {
        const oldLink = mkManyOneLinkFieldWithForeign('srcLink', `tbl${'b'.repeat(16)}`);
        const newLink = mkManyOneLinkFieldWithForeign('tgtLink', `tbl${'c'.repeat(16)}`);
        const sqls = getConversionSqls(oldLink, newLink);
        const mappingSql = sqls.find((sql) => sql.includes('DO $v2_link_remap$'));
        expect(mappingSql).toBeDefined();
        expect(mappingSql).toContain('jsonb_array_elements');
        expect(mappingSql).toContain("->> ''title''");
        expect(mappingSql).toContain('mapped AS');
        expect(mappingSql).toContain('picked AS');
        expect(mappingSql).toContain('SELECT DISTINCT ON (p.source_id, p.part_idx)');
        expect(mappingSql).toContain('ORDER BY p.source_id, p.part_idx, f.__id');
      });

      it('should detect that formula requires schema recreation', () => {
        const expression = FormulaExpression.create('1 + 1')._unsafeUnwrap();
        const formulaField = createFormulaField({
          id: mkFieldId('fmlConv'),
          name: mkFieldName('Formula'),
          expression,
        })._unsafeUnwrap();

        // Formula fields require schema recreation (drop + create),
        // which needs fully configured fields (dbFieldName, generated column meta, etc.).
        // Here we verify the function recognizes it as a schema recreation case
        // by calling the factory directly - the factory returns an error for formula as source.
        const params = createParams();
        const factory = new FieldTypeConversionVisitorFactory(params);
        const visitorResult = formulaField.accept(factory);
        expect(visitorResult.isErr()).toBe(true);
        expect(visitorResult._unsafeUnwrapErr().message).toContain('formula');
      });

      it('should detect that autoNumber requires schema recreation', () => {
        const autoField = createAutoNumberField({
          id: mkFieldId('autoConv'),
          name: mkFieldName('AutoNumber'),
        })._unsafeUnwrap();

        // AutoNumber fields require schema recreation (drop + create).
        // Verify the factory correctly identifies autoNumber as unconvertible source.
        const params = createParams();
        const factory = new FieldTypeConversionVisitorFactory(params);
        const visitorResult = autoField.accept(factory);
        expect(visitorResult.isErr()).toBe(true);
        expect(visitorResult._unsafeUnwrapErr().message).toContain('auto number');
      });

      it('should detect that createdTime requires schema recreation', () => {
        const field = createCreatedTimeField({
          id: mkFieldId('ctConv'),
          name: mkFieldName('Created'),
        })._unsafeUnwrap();

        const params = createParams();
        const factory = new FieldTypeConversionVisitorFactory(params);
        const visitorResult = field.accept(factory);
        expect(visitorResult.isErr()).toBe(true);
        expect(visitorResult._unsafeUnwrapErr().message).toContain('created time');
      });
    });
  });

  describe('generateSelectOptionsFromValues', () => {
    it('should generate SQL with DISTINCT query for values', () => {
      // When converting text -> singleSelect, the options generation is triggered
      const sqls = getVisitorSqls(mkTextField(), mkSingleSelField());
      const optionsSql = sqls.find((s) => s.includes('distinct_values'));
      expect(optionsSql).toBeDefined();
      expect(optionsSql).toContain('SELECT DISTINCT');
    });

    it('should generate SQL to filter out existing options', () => {
      const sqls = getVisitorSqls(mkTextField(), mkSingleSelField());
      const optionsSql = sqls.find((s) => s.includes('existing_choices'));
      expect(optionsSql).toBeDefined();
      expect(optionsSql).toContain('NOT IN');
      expect(optionsSql).toContain('existing_names');
    });

    it('should generate SQL with random ID generation', () => {
      const sqls = getVisitorSqls(mkTextField(), mkSingleSelField());
      const optionsSql = sqls.find((s) => s.includes('cho'));
      expect(optionsSql).toBeDefined();
      expect(optionsSql).toContain("'cho'");
      expect(optionsSql).toContain('md5(random()');
      expect(optionsSql).toContain('substr');
    });

    it('should generate SQL with color assignment from palette', () => {
      const sqls = getVisitorSqls(mkTextField(), mkSingleSelField());
      const optionsSql = sqls.find((s) => s.includes('color'));
      expect(optionsSql).toBeDefined();
      expect(optionsSql).toContain('ARRAY[');
      // Colors are parameterized by Kysely (e.g., $2, $3, ...) rather than literal strings
      expect(optionsSql).toContain("'color'");
      expect(optionsSql).toMatch(/\(rn % \$\d+\) \+ 1/);
    });

    it('should generate SQL to merge with existing choices', () => {
      const sqls = getVisitorSqls(mkTextField(), mkSingleSelField());
      const optionsSql = sqls.find((s) => s.includes('merged_choices'));
      expect(optionsSql).toBeDefined();
      expect(optionsSql).toContain('COALESCE');
      expect(optionsSql).toContain("'[]'::jsonb");
    });

    it('should return null if fieldId is not provided', () => {
      // Create visitor params without fieldId
      const params = createParams({ fieldId: undefined });
      const factory = new FieldTypeConversionVisitorFactory(params);
      const visitorResult = mkTextField().accept(factory);
      expect(visitorResult.isOk()).toBe(true);
      const visitor = visitorResult._unsafeUnwrap();
      // text -> singleSelect with no fieldId should not produce options generation
      const statementsResult = mkSingleSelField().accept(visitor);
      expect(statementsResult.isOk()).toBe(true);
      const statements = statementsResult._unsafeUnwrap();
      // Without fieldId, no options generation statement is emitted
      // (text -> singleSelect is same DB type, so no ALTER either)
      expect(statements).toHaveLength(0);
    });
  });

  describe('formula → text conversion (generateFieldConversionStatements)', () => {
    const mkFormulaDateTimeField = (
      dateFormat: string = DateFormattingPreset.ISO,
      timeFormat: TimeFormatting = TimeFormatting.Hour12,
      tzString: string = 'America/Los_Angeles'
    ) => {
      const expression = FormulaExpression.create('{fld0000000000000001}')._unsafeUnwrap();
      const tz = TimeZone.create(tzString)._unsafeUnwrap();
      const formatting = DateTimeFormatting.create({
        date: dateFormat,
        time: timeFormat,
        timeZone: tzString,
      })._unsafeUnwrap();
      const field = createFormulaField({
        id: mkFieldId('fmlDt'),
        name: mkFieldName('FormulaDate'),
        expression,
        timeZone: tz,
        formatting,
        resultType: {
          cellValueType: CellValueType.dateTime(),
          isMultipleCellValue: CellValueMultiplicity.single(),
        },
      })._unsafeUnwrap();
      const dbField = DbFieldName.rehydrate(DB_FIELD_NAME)._unsafeUnwrap();
      field.setDbFieldName(dbField);
      return field;
    };

    const mkFormulaStringField = () => {
      const expression = FormulaExpression.create('"hello"')._unsafeUnwrap();
      const field = createFormulaField({
        id: mkFieldId('fmlStr'),
        name: mkFieldName('FormulaStr'),
        expression,
        resultType: {
          cellValueType: CellValueType.string(),
          isMultipleCellValue: CellValueMultiplicity.single(),
        },
      })._unsafeUnwrap();
      const dbField = DbFieldName.rehydrate(DB_FIELD_NAME)._unsafeUnwrap();
      field.setDbFieldName(dbField);
      return field;
    };

    const mkFormulaNumberField = () => {
      const expression = FormulaExpression.create('1 + 1')._unsafeUnwrap();
      const field = createFormulaField({
        id: mkFieldId('fmlNum'),
        name: mkFieldName('FormulaNum'),
        expression,
        resultType: {
          cellValueType: CellValueType.number(),
          isMultipleCellValue: CellValueMultiplicity.single(),
        },
      })._unsafeUnwrap();
      const dbField = DbFieldName.rehydrate(DB_FIELD_NAME)._unsafeUnwrap();
      field.setDbFieldName(dbField);
      return field;
    };

    it('should rename column to temp, drop, create, migrate with to_char, then drop temp (datetime formula → text)', () => {
      const formulaField = mkFormulaDateTimeField();
      const textField = mkTextField();
      const sqls = getConversionSqls(formulaField, textField);

      // 1. Rename old column to temp
      expect(sqls[0]).toContain('RENAME COLUMN');
      expect(sqls[0]).toContain('__tmp_formula_src_');

      // Last statement should drop the temp column
      const lastSql = sqls[sqls.length - 1];
      expect(lastSql).toContain('DROP COLUMN IF EXISTS');
      expect(lastSql).toContain('__tmp_formula_src_');

      // Somewhere in between: migration with to_char and AT TIME ZONE
      const migrateSql = sqls.find((s) => s.includes('to_char'));
      expect(migrateSql).toBeDefined();
      expect(migrateSql).toContain('AT TIME ZONE');
      expect(migrateSql).toContain('America/Los_Angeles');
    });

    it('should use correct PostgreSQL format for ISO date + Hour12 time', () => {
      const formulaField = mkFormulaDateTimeField(
        DateFormattingPreset.ISO,
        TimeFormatting.Hour12,
        'America/Los_Angeles'
      );
      const textField = mkTextField();
      const sqls = getConversionSqls(formulaField, textField);

      const migrateSql = sqls.find((s) => s.includes('to_char'))!;
      // 'YYYY-MM-DD hh:mm A' → 'YYYY-MM-DD HH12:MI AM'
      expect(migrateSql).toContain('YYYY-MM-DD HH12:MI AM');
    });

    it('should use correct PostgreSQL format for US date + Hour24 time', () => {
      const formulaField = mkFormulaDateTimeField(
        DateFormattingPreset.US,
        TimeFormatting.Hour24,
        'UTC'
      );
      const textField = mkTextField();
      const sqls = getConversionSqls(formulaField, textField);

      const migrateSql = sqls.find((s) => s.includes('to_char'))!;
      // 'M/D/YYYY HH:mm' → 'FMMM/FMDD/YYYY HH24:MI'
      expect(migrateSql).toContain('FMMM/FMDD/YYYY HH24:MI');
    });

    it('should use correct PostgreSQL format for European date + no time', () => {
      const formulaField = mkFormulaDateTimeField(
        DateFormattingPreset.European,
        TimeFormatting.None,
        'Europe/London'
      );
      const textField = mkTextField();
      const sqls = getConversionSqls(formulaField, textField);

      const migrateSql = sqls.find((s) => s.includes('to_char'))!;
      // 'D/M/YYYY' → 'FMDD/FMMM/YYYY'
      expect(migrateSql).toContain('FMDD/FMMM/YYYY');
      expect(migrateSql).not.toContain('HH');
    });

    it('should use text cast for string formula → text', () => {
      const formulaField = mkFormulaStringField();
      const textField = mkTextField();
      const sqls = getConversionSqls(formulaField, textField);

      // Should use temp column rename pattern
      expect(sqls[0]).toContain('RENAME COLUMN');
      // Should use ::text cast, not to_char
      const migrateSql = sqls.find((s) => s.includes('::text'));
      expect(migrateSql).toBeDefined();
      expect(sqls.find((s) => s.includes('to_char'))).toBeUndefined();
    });

    it('should use text cast for number formula → text', () => {
      const formulaField = mkFormulaNumberField();
      const textField = mkTextField();
      const sqls = getConversionSqls(formulaField, textField);

      expect(sqls[0]).toContain('RENAME COLUMN');
      const migrateSql = sqls.find((s) => s.includes('::text'));
      expect(migrateSql).toBeDefined();
      expect(sqls.find((s) => s.includes('to_char'))).toBeUndefined();
    });

    it('should directly copy number formula → number', () => {
      const formulaField = mkFormulaNumberField();
      const numField = mkNumField();
      const sqls = getConversionSqls(formulaField, numField);

      expect(sqls[0]).toContain('RENAME COLUMN');
      // Should have a direct copy (no ::text cast, no to_char)
      const migrateSql = sqls.find((s) => s.includes('UPDATE') && s.includes('__tmp_formula_src_'));
      expect(migrateSql).toBeDefined();
      expect(migrateSql).not.toContain('to_char');
      expect(migrateSql).not.toContain('::text');
    });

    it('should produce NULL for datetime formula → number (incompatible)', () => {
      const formulaField = mkFormulaDateTimeField();
      const numField = mkNumField();
      const sqls = getConversionSqls(formulaField, numField);

      expect(sqls[0]).toContain('RENAME COLUMN');
      // No migration UPDATE should exist (returns null → column stays NULL)
      const migrateSql = sqls.find((s) => s.includes('UPDATE') && s.includes('__tmp_formula_src_'));
      expect(migrateSql).toBeUndefined();
    });

    it('should directly copy datetime formula → date', () => {
      const formulaField = mkFormulaDateTimeField();
      const dateField = mkDateField();
      const sqls = getConversionSqls(formulaField, dateField);

      expect(sqls[0]).toContain('RENAME COLUMN');
      const migrateSql = sqls.find((s) => s.includes('UPDATE') && s.includes('__tmp_formula_src_'));
      expect(migrateSql).toBeDefined();
      // timestamptz → timestamptz: direct copy, no format conversion
      expect(migrateSql).not.toContain('to_char');
    });

    it('should convert any non-null formula → checkbox as TRUE', () => {
      const formulaField = mkFormulaNumberField();
      const checkField = mkCheckField();
      const sqls = getConversionSqls(formulaField, checkField);

      expect(sqls[0]).toContain('RENAME COLUMN');
      const migrateSql = sqls.find((s) => s.includes('TRUE'));
      expect(migrateSql).toBeDefined();
    });

    it('should format datetime formula → singleSelect with to_char', () => {
      const formulaField = mkFormulaDateTimeField();
      const selField = mkSingleSelField();
      const sqls = getConversionSqls(formulaField, selField);

      expect(sqls[0]).toContain('RENAME COLUMN');
      const migrateSql = sqls.find((s) => s.includes('to_char'));
      expect(migrateSql).toBeDefined();
      // Should also generate select options
      const optionsSql = sqls.find((s) => s.includes('distinct_values'));
      expect(optionsSql).toBeDefined();
    });

    it('should wrap number formula → multipleSelect as jsonb array', () => {
      const formulaField = mkFormulaNumberField();
      const multiSelField = mkMultiSelField();
      const sqls = getConversionSqls(formulaField, multiSelField);

      expect(sqls[0]).toContain('RENAME COLUMN');
      const migrateSql = sqls.find((s) => s.includes('jsonb_build_array'));
      expect(migrateSql).toBeDefined();
    });
  });
});
