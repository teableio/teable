/**
 * Unit tests for TableSchemaUpdateVisitor using SQL snapshots.
 *
 * These tests validate the SQL statements generated for various
 * field update operations using Kysely DummyDriver (no actual database connection).
 */
import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldHasError,
  FieldName,
  FormulaExpression,
  LinkFieldConfig,
  Table,
  TableAddFieldSpec,
  TableAddFieldsSpec,
  TableId,
  TableName,
  TableUpdateFieldHasErrorSpec,
  UpdateLinkRelationshipSpec,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { TableSchemaUpdateVisitor } from '../TableSchemaUpdateVisitor';
import { createTestDb } from './helpers/createTestDb';
import { createDtField } from './helpers/fieldFactories';

describe('TableSchemaUpdateVisitor', () => {
  describe('visitTableUpdateFieldConstraints', () => {
    describe('NOT NULL constraint', () => {
      it.todo(
        'should generate SQL to add NOT NULL constraint'
        // Verify: ALTER TABLE ... ALTER COLUMN ... SET NOT NULL
      );

      it.todo(
        'should generate SQL to remove NOT NULL constraint'
        // Verify: ALTER TABLE ... ALTER COLUMN ... DROP NOT NULL
      );

      it.todo(
        'should generate no SQL when NOT NULL is not changing'
        // Verify: empty statements array
      );
    });

    describe('UNIQUE constraint', () => {
      it.todo(
        'should generate SQL to add UNIQUE constraint'
        // Verify: ALTER TABLE ... ADD CONSTRAINT ... UNIQUE (col)
      );

      it.todo(
        'should generate SQL to remove UNIQUE constraint'
        // Verify: ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...
      );

      it.todo(
        'should generate no SQL when UNIQUE is not changing'
        // Verify: empty statements array
      );

      it.todo(
        'should generate constraint name from table and column'
        // Verify: constraint name = tableName_columnName_unique
      );
    });

    describe('combined changes', () => {
      it.todo(
        'should generate both NOT NULL and UNIQUE statements when both changing'
        // Verify: two ALTER statements
      );

      it.todo(
        'should handle adding both constraints'
        // Verify: SET NOT NULL and ADD CONSTRAINT
      );

      it.todo(
        'should handle removing both constraints'
        // Verify: DROP NOT NULL and DROP CONSTRAINT
      );

      it.todo(
        'should handle mixed changes (add one, remove other)'
        // Verify: appropriate combination
      );
    });
  });

  describe('visitUpdateRatingMax', () => {
    describe('max decreasing', () => {
      it.todo(
        'should generate SQL to clamp values above new max'
        // Verify: UPDATE ... SET col = newMax WHERE col > newMax
      );

      it.todo(
        'should use correct new max value from spec'
        // Verify: max value from spec is used
      );

      it.todo(
        'should include schema-qualified table name'
        // Verify: "schema"."table" format
      );
    });

    describe('max increasing', () => {
      it.todo(
        'should generate no SQL when max is increasing (no-op)'
        // Verify: empty statements array
      );

      it.todo(
        'should generate no SQL when max is unchanged'
        // Verify: empty statements array
      );
    });
  });

  describe('visitUpdateUserMultiplicity', () => {
    describe('single -> multiple', () => {
      it.todo(
        'should generate SQL to wrap single object in jsonb array'
        // Verify: UPDATE ... SET col = jsonb_build_array(col) WHERE col IS NOT NULL
      );
    });

    describe('multiple -> single', () => {
      it.todo(
        'should generate SQL to extract first element from jsonb array'
        // Verify: UPDATE ... SET col = (col->0) WHERE ... jsonb_array_length > 0
      );
    });

    describe('no change', () => {
      it.todo(
        'should generate no SQL when multiplicity is not changing'
        // Verify: empty statements array
      );

      it.todo(
        'should generate no SQL for single -> single'
        // Verify: empty statements array
      );

      it.todo(
        'should generate no SQL for multiple -> multiple'
        // Verify: empty statements array
      );
    });
  });

  describe('visitUpdateSingleSelectOptions', () => {
    describe('renamed options', () => {
      it.todo(
        'should generate SQL to update values with old name to new name'
        // Verify: UPDATE ... SET col = 'new_name' WHERE col = 'old_name'
      );

      it.todo(
        'should generate one statement per renamed option'
        // Verify: count of statements = count of renamed options
      );

      it.todo(
        'should handle multiple option renames'
        // Verify: multiple UPDATE statements
      );
    });

    describe('removed options', () => {
      it.todo(
        'should generate SQL to set removed option values to NULL'
        // Verify: UPDATE ... SET col = NULL WHERE col = 'deleted_name'
      );

      it.todo(
        'should generate one statement per removed option'
        // Verify: count of statements = count of removed options
      );
    });

    describe('combined operations', () => {
      it.todo(
        'should handle both renames and removals'
        // Verify: rename statements + removal statements
      );

      it.todo(
        'should generate no SQL when no options changed'
        // Verify: empty statements array
      );
    });
  });

  describe('visitUpdateMultipleSelectOptions', () => {
    describe('renamed options (array_replace)', () => {
      it.todo(
        'should generate SQL using array_replace to rename in arrays'
        // Verify: UPDATE ... SET col = array_replace(col, 'old', 'new') WHERE 'old' = ANY(col)
      );

      it.todo(
        'should include WHERE clause with ANY check'
        // Verify: WHERE 'old' = ANY(col)
      );
    });

    describe('removed options (array_remove)', () => {
      it.todo(
        'should generate SQL using array_remove to remove from arrays'
        // Verify: UPDATE ... SET col = array_remove(col, 'deleted') WHERE 'deleted' = ANY(col)
      );

      it.todo(
        'should include WHERE clause with ANY check'
        // Verify: WHERE 'deleted' = ANY(col)
      );
    });

    describe('combined operations', () => {
      it.todo(
        'should handle both renames and removals in arrays'
        // Verify: array_replace statements + array_remove statements
      );
    });
  });

  describe('Metadata-only updates (return empty statements)', () => {
    describe('field name updates', () => {
      it.todo(
        'should return empty array for visitTableUpdateFieldName'
        // Verify: statements array is empty
      );
    });

    describe('formatting updates', () => {
      it.todo(
        'should return empty array for visitUpdateNumberFormatting'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateDateFormatting'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateFormulaFormatting'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateRollupFormatting'
        // Verify: statements array is empty
      );
    });

    describe('showAs updates', () => {
      it.todo(
        'should return empty array for visitUpdateSingleLineTextShowAs'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateNumberShowAs'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateFormulaShowAs'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateRollupShowAs'
        // Verify: statements array is empty
      );
    });

    describe('default value updates', () => {
      it.todo(
        'should return empty array for visitUpdateSingleLineTextDefaultValue'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateLongTextDefaultValue'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateNumberDefaultValue'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateDateDefaultValue'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateCheckboxDefaultValue'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateSingleSelectDefaultValue'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateMultipleSelectDefaultValue'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateUserDefaultValue'
        // Verify: statements array is empty
      );
    });

    describe('other metadata updates', () => {
      it.todo(
        'should return empty array for visitUpdateRatingIcon'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateRatingColor'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateUserNotification'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateButtonLabel'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateButtonColor'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateButtonMaxCount'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateButtonWorkflow'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitTableUpdateFieldHasError'
        // Verify: statements array is empty
      );
    });

    describe('autoNewOptions updates', () => {
      it.todo(
        'should return empty array for visitUpdateSingleSelectAutoNewOptions'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateMultipleSelectAutoNewOptions'
        // Verify: statements array is empty
      );
    });

    describe('formula/rollup updates', () => {
      it.todo(
        'should return empty array for visitUpdateFormulaExpression'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateFormulaTimeZone'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateRollupConfig'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateRollupExpression'
        // Verify: statements array is empty
      );

      it.todo(
        'should return empty array for visitUpdateRollupTimeZone'
        // Verify: statements array is empty
      );
    });

    describe('lookup updates', () => {
      it.todo(
        'should return empty array for visitUpdateLookupOptions'
        // Verify: statements array is empty
      );
    });

    describe('link updates', () => {
      it.todo(
        'should return empty array for visitUpdateLinkConfig'
        // Verify: statements array is empty (complex changes handled by handler)
      );
    });
  });

  describe('visitUpdateLinkRelationship', () => {
    // IDs: prefix (3) + body (16) = 19 chars total
    const SRC_FIELD_ID = 'fldSrcField00000001'; // source link field
    const SYM_FIELD_ID = 'fldSymField00000001'; // symmetric link field
    const FOREIGN_TBL_ID = 'tblForeignTbl000001'; // foreign table
    const LOOKUP_FLD_ID = 'fldLookupFld0000001'; // lookup field
    const SCHEMA = 'bseTestBase000000001';
    const SOURCE_TBL = 'tblSrcTable00000001';

    const db = createTestDb();

    const createConfig = (params: {
      relationship: string;
      isOneWay: boolean;
      fkHostTableName?: string;
      selfKeyName?: string;
      foreignKeyName?: string;
      symmetricFieldId?: string;
    }) => {
      return LinkFieldConfig.create({
        relationship: params.relationship,
        foreignTableId: FOREIGN_TBL_ID,
        lookupFieldId: LOOKUP_FLD_ID,
        isOneWay: params.isOneWay,
        fkHostTableName: params.fkHostTableName,
        selfKeyName: params.selfKeyName,
        foreignKeyName: params.foreignKeyName,
        symmetricFieldId: params.symmetricFieldId,
      })._unsafeUnwrap();
    };

    const createSpec = (params: {
      previousConfig: LinkFieldConfig;
      nextConfig: LinkFieldConfig;
      computedNextConfig?: LinkFieldConfig;
    }) => {
      const fieldId = FieldId.create(SRC_FIELD_ID)._unsafeUnwrap();
      const dbFieldName = DbFieldName.rehydrate('link_field')._unsafeUnwrap();
      const spec = UpdateLinkRelationshipSpec.create({
        fieldId,
        dbFieldName,
        previousConfig: params.previousConfig,
        nextConfig: params.nextConfig,
      });
      // Manually inject computedNextConfig for unit testing (normally set by mutate())
      if (params.computedNextConfig) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (spec as any).computedNextConfigValue = params.computedNextConfig;
      }
      return spec;
    };

    const createVisitor = () =>
      new TableSchemaUpdateVisitor({
        db,
        schema: SCHEMA,
        tableName: SOURCE_TBL,
        tableId: SOURCE_TBL,
      });

    const JUNCTION_TABLE = `${SCHEMA}.junction_${SRC_FIELD_ID}_${SYM_FIELD_ID}`;
    const ONEWAY_JUNCTION = `${SCHEMA}.junction_${SRC_FIELD_ID}`;
    const FOREIGN_TABLE = `${SCHEMA}.${FOREIGN_TBL_ID}`;
    const SELF_KEY = `__fk_${SYM_FIELD_ID}`;
    const FOREIGN_KEY = `__fk_${SRC_FIELD_ID}`;

    it('should generate DROP __order statement for oneWay manyMany → oneMany', () => {
      const previousConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: true,
        fkHostTableName: ONEWAY_JUNCTION,
        selfKeyName: SELF_KEY,
        foreignKeyName: FOREIGN_KEY,
      });
      const nextConfig = createConfig({
        relationship: 'oneMany',
        isOneWay: true,
        fkHostTableName: ONEWAY_JUNCTION,
        selfKeyName: SELF_KEY,
        foreignKeyName: FOREIGN_KEY,
      });

      const spec = createSpec({ previousConfig, nextConfig });
      const visitor = createVisitor();
      const result = visitor.visitUpdateLinkRelationship(spec);

      expect(result.isOk()).toBe(true);
      // ManyMany has __order column in junction; OneMany OneWay does not.
      // Generates a DROP COLUMN statement.
      expect(result._unsafeUnwrap().length).toBeGreaterThanOrEqual(1);
    });

    it('should generate ADD __order statement for oneWay oneMany → manyMany', () => {
      const previousConfig = createConfig({
        relationship: 'oneMany',
        isOneWay: true,
        fkHostTableName: ONEWAY_JUNCTION,
        selfKeyName: SELF_KEY,
        foreignKeyName: FOREIGN_KEY,
      });
      const nextConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: true,
        fkHostTableName: ONEWAY_JUNCTION,
        selfKeyName: SELF_KEY,
        foreignKeyName: FOREIGN_KEY,
      });

      const spec = createSpec({ previousConfig, nextConfig });
      const visitor = createVisitor();
      const result = visitor.visitUpdateLinkRelationship(spec);

      expect(result.isOk()).toBe(true);
      // OneMany OneWay junction has no __order; ManyMany has __order.
      // Generates an ADD COLUMN statement.
      expect(result._unsafeUnwrap().length).toBeGreaterThanOrEqual(1);
    });

    it('should generate junction → FK migration SQL (manyMany twoWay → oneMany twoWay)', () => {
      const previousConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: false,
        fkHostTableName: JUNCTION_TABLE,
        selfKeyName: SELF_KEY,
        foreignKeyName: FOREIGN_KEY,
        symmetricFieldId: SYM_FIELD_ID,
      });
      const nextConfig = createConfig({
        relationship: 'oneMany',
        isOneWay: false,
        symmetricFieldId: SYM_FIELD_ID,
      });
      // computedNextConfig: after ensureDbConfig, oneMany twoWay uses FK column on foreign table
      const computedNextConfig = createConfig({
        relationship: 'oneMany',
        isOneWay: false,
        fkHostTableName: FOREIGN_TABLE,
        selfKeyName: SELF_KEY,
        foreignKeyName: '__id',
        symmetricFieldId: SYM_FIELD_ID,
      });

      const spec = createSpec({ previousConfig, nextConfig, computedNextConfig });
      const visitor = createVisitor();
      const result = visitor.visitUpdateLinkRelationship(spec);

      expect(result.isOk()).toBe(true);
      const statements = result._unsafeUnwrap();
      expect(statements).toHaveLength(5);

      const sqls = statements.map((s) => s.compile(db).sql);
      // 1. Add FK column to foreign table
      // 2. Add order column to foreign table
      // 3. Migrate data from junction to FK column
      // 4. Drop junction table
      expect(sqls[0]).toContain('ADD COLUMN IF NOT EXISTS');
      expect(sqls[0]).toContain(SELF_KEY);
      expect(sqls[0]).toContain('text');
      expect(sqls[1]).toContain('ADD COLUMN IF NOT EXISTS');
      expect(sqls[1]).toContain(`${SELF_KEY}_order`);
      expect(sqls[1]).toContain('double precision');
      expect(sqls[2]).toContain('UPDATE');
      expect(sqls[2]).toContain('FROM');
      expect(sqls[3]).toContain('DROP TABLE IF EXISTS');
      expect(sqls[4]).toContain('DO $v2_link_trim$');
      expect(sqls).toMatchSnapshot();
    });

    it('should migrate manyMany twoWay → manyOne twoWay using foreignKeyName column', () => {
      const previousConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: false,
        fkHostTableName: JUNCTION_TABLE,
        selfKeyName: SELF_KEY,
        foreignKeyName: FOREIGN_KEY,
        symmetricFieldId: SYM_FIELD_ID,
      });
      const nextConfig = createConfig({
        relationship: 'manyOne',
        isOneWay: false,
        symmetricFieldId: SYM_FIELD_ID,
      });
      const computedNextConfig = createConfig({
        relationship: 'manyOne',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${SOURCE_TBL}`,
        selfKeyName: '__id',
        foreignKeyName: FOREIGN_KEY,
        symmetricFieldId: SYM_FIELD_ID,
      });

      const spec = createSpec({ previousConfig, nextConfig, computedNextConfig });
      const visitor = createVisitor();
      const result = visitor.visitUpdateLinkRelationship(spec);

      expect(result.isOk()).toBe(true);
      const statements = result._unsafeUnwrap();
      expect(statements).toHaveLength(6);

      const sqls = statements.map((s) => s.compile(db).sql);
      expect(sqls[0]).toContain(`ADD COLUMN IF NOT EXISTS "${FOREIGN_KEY}" text`);
      expect(sqls[0]).not.toContain('"__id" text');
      expect(sqls[1]).toContain(`ADD COLUMN IF NOT EXISTS "${FOREIGN_KEY}_order"`);
      expect(sqls[2]).toContain(`j."${FOREIGN_KEY}"`);
      expect(sqls[2]).toContain(`WHERE j."${SELF_KEY}" = h."__id"`);
      expect(sqls[3]).toContain('DROP TABLE IF EXISTS');
      expect(sqls[4]).toContain('DO $v2_link_trim$');
      expect(sqls[5]).toContain('jsonb_array_length');
    });

    it('should generate FK → junction migration SQL (oneMany twoWay → manyMany twoWay)', () => {
      const previousConfig = createConfig({
        relationship: 'oneMany',
        isOneWay: false,
        fkHostTableName: FOREIGN_TABLE,
        selfKeyName: SELF_KEY,
        foreignKeyName: '__id',
        symmetricFieldId: SYM_FIELD_ID,
      });
      const nextConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: false,
        symmetricFieldId: SYM_FIELD_ID,
      });
      // computedNextConfig: after ensureDbConfig, manyMany twoWay uses junction table
      const computedNextConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: false,
        fkHostTableName: JUNCTION_TABLE,
        selfKeyName: SELF_KEY,
        foreignKeyName: FOREIGN_KEY,
        symmetricFieldId: SYM_FIELD_ID,
      });

      const spec = createSpec({ previousConfig, nextConfig, computedNextConfig });
      const visitor = createVisitor();
      const result = visitor.visitUpdateLinkRelationship(spec);

      expect(result.isOk()).toBe(true);
      const statements = result._unsafeUnwrap();
      expect(statements).toHaveLength(4);

      const sqls = statements.map((s) => s.compile(db).sql);
      // 1. Create junction table
      // 2. Insert data from FK column
      // 3. Drop FK column
      // 4. Drop order column
      expect(sqls[0]).toContain('CREATE TABLE IF NOT EXISTS');
      expect(sqls[0]).toContain(SELF_KEY);
      expect(sqls[0]).toContain(FOREIGN_KEY);
      expect(sqls[0]).toContain('__order');
      expect(sqls[1]).toContain('INSERT INTO');
      expect(sqls[1]).toContain('SELECT');
      expect(sqls[2]).toContain('DROP COLUMN IF EXISTS');
      expect(sqls[2]).toContain(SELF_KEY);
      expect(sqls[3]).toContain('DROP COLUMN IF EXISTS');
      expect(sqls[3]).toContain(`${SELF_KEY}_order`);
      expect(sqls).toMatchSnapshot();
    });

    it('should not drop __id when generating FK → junction SQL from manyOne', () => {
      const previousConfig = createConfig({
        relationship: 'manyOne',
        isOneWay: false,
        fkHostTableName: FOREIGN_TABLE,
        selfKeyName: '__id',
        foreignKeyName: FOREIGN_KEY,
        symmetricFieldId: SYM_FIELD_ID,
      });
      const nextConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: false,
        symmetricFieldId: SYM_FIELD_ID,
      });
      const computedNextConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: false,
        fkHostTableName: JUNCTION_TABLE,
        selfKeyName: SELF_KEY,
        foreignKeyName: FOREIGN_KEY,
        symmetricFieldId: SYM_FIELD_ID,
      });

      const spec = createSpec({ previousConfig, nextConfig, computedNextConfig });
      const visitor = createVisitor();
      const result = visitor.visitUpdateLinkRelationship(spec);

      expect(result.isOk()).toBe(true);
      const statements = result._unsafeUnwrap();
      expect(statements).toHaveLength(5);

      const sqls = statements.map((s) => s.compile(db).sql);
      expect(sqls[1]).toContain(`SELECT "__id", COALESCE("${FOREIGN_KEY}"`);
      expect(sqls[2]).toContain('DROP COLUMN IF EXISTS');
      expect(sqls[2]).toContain(`"${FOREIGN_KEY}"`);
      expect(sqls[2]).not.toContain('"__id"');
      expect(sqls[3]).toContain('DROP COLUMN IF EXISTS');
      expect(sqls[3]).toContain(`"${FOREIGN_KEY}_order"`);
      expect(sqls[4]).toContain('jsonb_build_array');
      expect(sqls[4]).toContain('"link_field"');
    });

    it('should migrate FK host for manyOne → oneMany twoWay conversion', () => {
      const previousConfig = createConfig({
        relationship: 'manyOne',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${SOURCE_TBL}`,
        selfKeyName: '__id',
        foreignKeyName: FOREIGN_KEY,
        symmetricFieldId: SYM_FIELD_ID,
      });
      const nextConfig = createConfig({
        relationship: 'oneMany',
        isOneWay: false,
        symmetricFieldId: SYM_FIELD_ID,
      });
      const computedNextConfig = createConfig({
        relationship: 'oneMany',
        isOneWay: false,
        fkHostTableName: FOREIGN_TABLE,
        selfKeyName: SELF_KEY,
        foreignKeyName: '__id',
        symmetricFieldId: SYM_FIELD_ID,
      });

      const spec = createSpec({ previousConfig, nextConfig, computedNextConfig });
      const visitor = createVisitor();
      const result = visitor.visitUpdateLinkRelationship(spec);

      expect(result.isOk()).toBe(true);
      const statements = result._unsafeUnwrap();
      expect(statements).toHaveLength(6);

      const sqls = statements.map((s) => s.compile(db).sql);
      expect(sqls[0]).toContain(
        `ALTER TABLE "${SCHEMA}"."${FOREIGN_TBL_ID}" ADD COLUMN IF NOT EXISTS "${SELF_KEY}" text`
      );
      expect(sqls[1]).toContain(
        `ALTER TABLE "${SCHEMA}"."${FOREIGN_TBL_ID}" ADD COLUMN IF NOT EXISTS "${SELF_KEY}_order" double precision`
      );
      expect(sqls[2]).toContain(`UPDATE "${SCHEMA}"."${FOREIGN_TBL_ID}" AS n`);
      expect(sqls[2]).toContain(`FROM "${SCHEMA}"."${SOURCE_TBL}" AS o`);
      expect(sqls[2]).toContain(`WHERE o."${FOREIGN_KEY}" = n."__id"`);
      expect(sqls[2]).toContain(`SET "${SELF_KEY}" = (`);
      expect(sqls[3]).toContain(
        `ALTER TABLE "${SCHEMA}"."${SOURCE_TBL}" DROP COLUMN IF EXISTS "${FOREIGN_KEY}"`
      );
      expect(sqls[4]).toContain(
        `ALTER TABLE "${SCHEMA}"."${SOURCE_TBL}" DROP COLUMN IF EXISTS "${FOREIGN_KEY}_order"`
      );
      expect(sqls[5]).toContain('jsonb_build_array');
    });

    it('should normalize manyOne FK host table from tableId to current db table name', () => {
      const previousConfig = createConfig({
        relationship: 'manyOne',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${SOURCE_TBL}`,
        selfKeyName: '__id',
        foreignKeyName: FOREIGN_KEY,
        symmetricFieldId: SYM_FIELD_ID,
      });
      const nextConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: false,
        symmetricFieldId: SYM_FIELD_ID,
      });
      const computedNextConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: false,
        fkHostTableName: JUNCTION_TABLE,
        selfKeyName: SELF_KEY,
        foreignKeyName: FOREIGN_KEY,
        symmetricFieldId: SYM_FIELD_ID,
      });

      const spec = createSpec({ previousConfig, nextConfig, computedNextConfig });
      const visitor = new TableSchemaUpdateVisitor({
        db,
        schema: SCHEMA,
        tableName: 'Trade_Records',
        tableId: SOURCE_TBL,
      });
      const result = visitor.visitUpdateLinkRelationship(spec);

      expect(result.isOk()).toBe(true);
      const sqls = result._unsafeUnwrap().map((s) => s.compile(db).sql);
      expect(sqls[1]).toContain(`FROM "${SCHEMA}"."Trade_Records"`);
      expect(sqls[2]).toContain(`ALTER TABLE "${SCHEMA}"."Trade_Records" DROP COLUMN IF EXISTS`);
    });

    it('should return empty statements when computedNextConfig is not available', () => {
      const previousConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: false,
        fkHostTableName: JUNCTION_TABLE,
        selfKeyName: SELF_KEY,
        foreignKeyName: FOREIGN_KEY,
        symmetricFieldId: SYM_FIELD_ID,
      });
      const nextConfig = createConfig({
        relationship: 'oneMany',
        isOneWay: false,
        symmetricFieldId: SYM_FIELD_ID,
      });

      // Do NOT set computedNextConfig — simulates mutate() not being called
      const spec = createSpec({ previousConfig, nextConfig });
      const visitor = createVisitor();
      const result = visitor.visitUpdateLinkRelationship(spec);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });
  });

  describe('visitTableUpdateFieldType', () => {
    it.todo(
      'should delegate to generateFieldConversionStatements'
      // Verify: conversion statements returned
    );

    it.todo(
      'should extract dbFieldName from old field'
      // Verify: dbFieldName used in conversion params
    );

    it.todo(
      'should pass fieldId from new field'
      // Verify: fieldId used for options generation
    );
  });

  describe('visitTableUpdateFieldHasError', () => {
    const db = createTestDb();
    const schema = `bse${'e'.repeat(16)}`;
    const tableName = `tbl${'f'.repeat(16)}`;
    const tableId = tableName;

    const createFormulaTable = () => {
      const baseId = BaseId.create(schema)._unsafeUnwrap();
      const aggregateTableId = TableId.create(tableId)._unsafeUnwrap();
      const sourceFieldId = FieldId.create(`fld${'1'.repeat(16)}`)._unsafeUnwrap();
      const formulaFieldId = FieldId.create(`fld${'2'.repeat(16)}`)._unsafeUnwrap();
      const builder = Table.builder()
        .withId(aggregateTableId)
        .withBaseId(baseId)
        .withName(TableName.create('Field Error Table')._unsafeUnwrap());
      builder
        .field()
        .singleLineText()
        .withId(sourceFieldId)
        .withName(FieldName.create('Source')._unsafeUnwrap())
        .primary()
        .done();
      builder
        .field()
        .formula()
        .withId(formulaFieldId)
        .withName(FieldName.create('Formula')._unsafeUnwrap())
        .withExpression(FormulaExpression.create(`{${sourceFieldId.toString()}}`)._unsafeUnwrap())
        .done();
      builder.view().defaultGrid().done();

      const table = builder.build()._unsafeUnwrap();
      const sourceField = table
        .getField((candidate) => candidate.id().equals(sourceFieldId))
        ._unsafeUnwrap();
      const formulaField = table
        .getField((candidate) => candidate.id().equals(formulaFieldId))
        ._unsafeUnwrap();
      sourceField.setDbFieldName(DbFieldName.rehydrate('source')._unsafeUnwrap())._unsafeUnwrap();
      formulaField.setDbFieldName(DbFieldName.rehydrate('formula')._unsafeUnwrap())._unsafeUnwrap();

      return table;
    };

    it('drops outbound references and clears stored values when setting hasError', () => {
      const table = createFormulaTable();
      const formulaField = table
        .getField((candidate) => candidate.name().toString() === 'Formula')
        ._unsafeUnwrap();
      const spec = TableUpdateFieldHasErrorSpec.setError(
        formulaField.id(),
        formulaField.hasError()
      );
      const visitor = new TableSchemaUpdateVisitor({
        db,
        schema,
        tableName,
        tableId,
        table,
      });

      const result = visitor.visitTableUpdateFieldHasError(spec);
      expect(result.isOk()).toBe(true);

      const sqls = result._unsafeUnwrap().map((statement) => statement.compile(db).sql);
      expect(sqls.some((sql) => sql.includes('delete from "reference"'))).toBe(true);
      expect(sqls.some((sql) => sql.includes('where "to_field_id" = $1'))).toBe(true);
      expect(
        sqls.some(
          (sql) =>
            sql.includes(`UPDATE "${schema}"."${tableName}" SET "formula" = NULL`) ||
            sql.includes(`update "${schema}"."${tableName}" set "formula" = NULL`)
        )
      ).toBe(true);
      expect(sqls.some((sql) => sql.includes('insert into "reference"'))).toBe(false);
    });

    it('rebuilds outbound references when clearing hasError', () => {
      const table = createFormulaTable();
      const formulaField = table
        .getField((candidate) => candidate.name().toString() === 'Formula')
        ._unsafeUnwrap();
      const spec = TableUpdateFieldHasErrorSpec.clearError(
        formulaField.id(),
        FieldHasError.error()
      );
      const visitor = new TableSchemaUpdateVisitor({
        db,
        schema,
        tableName,
        tableId,
        table,
      });

      const result = visitor.visitTableUpdateFieldHasError(spec);
      expect(result.isOk()).toBe(true);

      const sqls = result._unsafeUnwrap().map((statement) => statement.compile(db).sql);
      expect(sqls.some((sql) => sql.includes('delete from "reference"'))).toBe(true);
      expect(sqls.some((sql) => sql.includes('insert into "reference"'))).toBe(true);
      expect(sqls.some((sql) => sql.includes('update "') && sql.includes('"formula" = NULL'))).toBe(
        false
      );
    });
  });

  describe('visitTableAddField', () => {
    const SCHEMA = 'bseTestBase00000001';
    const TABLE_NAME = 'tblTestTable0000001';
    const TABLE_ID = TABLE_NAME;
    const db = createTestDb();

    const createTable = () => {
      const table = Table.builder()
        .withBaseId(BaseId.create(SCHEMA)._unsafeUnwrap())
        .withName(TableName.create('Test Table')._unsafeUnwrap());
      table.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
      table.view().defaultGrid().done();
      return table.build()._unsafeUnwrap();
    };

    const createVisitor = () =>
      new TableSchemaUpdateVisitor({
        db,
        schema: SCHEMA,
        tableName: TABLE_NAME,
        tableId: TABLE_ID,
        table: createTable(),
      });

    const createField = (params: { id: string; kind: 'singleLineText' | 'checkbox' | 'date' }) => {
      if (params.kind === 'date') {
        return createDtField(
          params.id,
          `Field ${params.id.slice(-4)}`,
          `fld_${params.id.slice(-8)}`
        )._unsafeUnwrap();
      }

      const table = Table.builder()
        .withBaseId(BaseId.create(SCHEMA)._unsafeUnwrap())
        .withName(TableName.create('Field Source')._unsafeUnwrap());
      const fieldBuilder = table.field();
      const fieldName = FieldName.create(`Field ${params.id.slice(-4)}`)._unsafeUnwrap();
      const fieldId = FieldId.create(params.id)._unsafeUnwrap();

      if (params.kind === 'singleLineText') {
        fieldBuilder.singleLineText().withId(fieldId).withName(fieldName).done();
      } else {
        fieldBuilder.checkbox().withId(fieldId).withName(fieldName).done();
      }

      table.view().defaultGrid().done();
      const fieldSource = table.build()._unsafeUnwrap();
      const field = fieldSource
        .getField((candidate) => candidate.id().equals(fieldId))
        ._unsafeUnwrap();
      const dbFieldName = DbFieldName.rehydrate(`fld_${params.id.slice(-8)}`)._unsafeUnwrap();
      field.setDbFieldName(dbFieldName)._unsafeUnwrap();
      return field;
    };

    it('should append search index statement for searchable field types', () => {
      const field = createField({ id: 'fldSearchField00001', kind: 'singleLineText' });
      const spec = TableAddFieldSpec.create(field);
      const visitor = createVisitor();

      const result = visitor.visitTableAddField(spec);
      expect(result.isOk()).toBe(true);

      const sqls = result._unsafeUnwrap().map((statement) => statement.compile(db).sql);
      expect(sqls.some((text) => text.includes("indexname LIKE 'idx_trgm%'"))).toBe(true);
      expect(sqls.some((text) => text.includes('CREATE INDEX IF NOT EXISTS'))).toBe(true);
    });

    it('should append a btree search index statement for date fields', () => {
      const field = createField({ id: 'fldDateField000001', kind: 'date' });
      const spec = TableAddFieldSpec.create(field);
      const visitor = createVisitor();

      const result = visitor.visitTableAddField(spec);
      expect(result.isOk()).toBe(true);

      const sqls = result._unsafeUnwrap().map((statement) => statement.compile(db).sql);
      expect(sqls.some((text) => text.includes("indexname LIKE 'idx_trgm%'"))).toBe(true);
      expect(sqls.some((text) => text.includes('CREATE INDEX IF NOT EXISTS'))).toBe(true);
      expect(sqls.some((text) => text.includes('USING btree'))).toBe(true);
      expect(sqls.some((text) => text.includes('gin_trgm_ops'))).toBe(false);
    });

    it('should not append search index statement for unsupported field types', () => {
      const field = createField({ id: 'fldCheckboxField001', kind: 'checkbox' });
      const spec = TableAddFieldSpec.create(field);
      const visitor = createVisitor();

      const result = visitor.visitTableAddField(spec);
      expect(result.isOk()).toBe(true);

      const sqls = result._unsafeUnwrap().map((statement) => statement.compile(db).sql);
      expect(sqls.some((text) => text.includes("indexname LIKE 'idx_trgm%'"))).toBe(false);
      expect(sqls.some((text) => text.includes('CREATE INDEX IF NOT EXISTS'))).toBe(false);
    });

    it('should generate statements for multiple fields in one batch spec', () => {
      const searchableField = createField({ id: 'fldSearchField00001', kind: 'singleLineText' });
      const unsupportedField = createField({ id: 'fldCheckboxField001', kind: 'checkbox' });
      const spec = TableAddFieldsSpec.create([searchableField, unsupportedField]);
      const visitor = createVisitor();

      const result = visitor.visitTableAddFields(spec);
      expect(result.isOk()).toBe(true);

      const sqls = result._unsafeUnwrap().map((statement) => statement.compile(db).sql);
      const searchableDbFieldName = searchableField
        .dbFieldName()
        ._unsafeUnwrap()
        .value()
        ._unsafeUnwrap();
      const unsupportedDbFieldName = unsupportedField
        .dbFieldName()
        ._unsafeUnwrap()
        .value()
        ._unsafeUnwrap();

      expect(sqls.length).toBeGreaterThanOrEqual(3);
      expect(sqls.some((text) => text.includes(searchableDbFieldName))).toBe(true);
      expect(sqls.some((text) => text.includes(unsupportedDbFieldName))).toBe(true);
      expect(sqls.some((text) => text.includes("indexname LIKE 'idx_trgm%'"))).toBe(true);
      expect(sqls.some((text) => text.includes('CREATE INDEX IF NOT EXISTS'))).toBe(true);
    });
  });

  describe('visitTableRemoveField', () => {
    it.todo(
      'should delegate to PostgresTableSchemaFieldDeleteVisitor'
      // Verify: delete statements returned
    );
  });

  describe('visitTableDuplicateField', () => {
    it.todo(
      'should create schema for new field'
      // Verify: field create statements
    );

    it.todo(
      'should add value duplication statements when includeRecordValues is true'
      // Verify: additional UPDATE statements for value copy
    );

    it.todo(
      'should not add value duplication when includeRecordValues is false'
      // Verify: only schema statements
    );
  });

  describe('Query specs (should return errors)', () => {
    it.todo(
      'should return error for visitTableByBaseId'
      // Verify: validation error
    );

    it.todo(
      'should return error for visitTableById'
      // Verify: validation error
    );

    it.todo(
      'should return error for visitTableByIds'
      // Verify: validation error
    );

    it.todo(
      'should return error for visitTableByNameLike'
      // Verify: validation error
    );
  });

  describe('clone, and, or, not methods', () => {
    it.todo(
      'should clone with same params'
      // Verify: cloned visitor has same behavior
    );

    it.todo(
      'should combine statements with and()'
      // Verify: concatenated arrays
    );

    it.todo(
      'should combine statements with or()'
      // Verify: concatenated arrays
    );

    it.todo(
      'should pass through statements with not()'
      // Verify: same array returned
    );
  });
});
