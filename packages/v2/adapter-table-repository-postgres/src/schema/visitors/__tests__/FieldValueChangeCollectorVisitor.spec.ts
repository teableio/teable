import {
  DbFieldName,
  FieldId,
  FieldName,
  FormulaExpression,
  LinkFieldConfig,
  LookupOptions,
  RatingMax,
  RollupExpression,
  RollupFieldConfig,
  SelectOption,
  TableUpdateFieldNameSpec,
  TableUpdateFieldTypeSpec,
  UpdateFormulaExpressionSpec,
  UpdateLinkConfigSpec,
  UpdateLinkRelationshipSpec,
  UpdateLookupOptionsSpec,
  UpdateMultipleSelectOptionsSpec,
  UpdateRatingMaxSpec,
  UpdateRollupConfigSpec,
  UpdateRollupExpressionSpec,
  UpdateSingleSelectOptionsSpec,
  UpdateUserMultiplicitySpec,
  UserMultiplicity,
  createFormulaField,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { FieldValueChangeCollectorVisitor } from '../FieldValueChangeCollectorVisitor';
import { createNumField, createTextField, createValidFieldId } from './helpers/fieldFactories';

const mkFieldId = (seed: string) => FieldId.create(createValidFieldId(seed))._unsafeUnwrap();
const mkDbFieldName = (name: string) => DbFieldName.rehydrate(name)._unsafeUnwrap();
const mkFieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();
const mkLinkConfig = (params: {
  relationship: string;
  foreignTableId: string;
  lookupFieldId: string;
  isOneWay?: boolean;
  symmetricFieldId?: string;
  fkHostTableName?: string;
  selfKeyName?: string;
  foreignKeyName?: string;
  filter?: unknown;
}) => LinkFieldConfig.create(params)._unsafeUnwrap();

describe('FieldValueChangeCollectorVisitor', () => {
  // ============ TableUpdateFieldTypeSpec ============

  describe('visitTableUpdateFieldType', () => {
    it('should collect valueChangedFieldIds for non-computed type conversion', () => {
      const oldField = createTextField('textA', 'Text', 'text_col')._unsafeUnwrap();
      const newField = createNumField('textA', 'Number', 'text_col')._unsafeUnwrap();
      const spec = TableUpdateFieldTypeSpec.create(oldField, newField);

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.valueChangedFields().map((id) => id.toString())).toEqual([
        newField.id().toString(),
      ]);
      expect(visitor.selfBackfillFields()).toEqual([]);
    });

    it('should collect both valueChanged and selfBackfill when new field is computed', () => {
      const oldField = createTextField('textB', 'Text', 'text_col')._unsafeUnwrap();
      const expression = FormulaExpression.create('1 + 1')._unsafeUnwrap();
      const newField = createFormulaField({
        id: mkFieldId('textB'),
        name: mkFieldName('Formula'),
        expression,
      })._unsafeUnwrap();
      const spec = TableUpdateFieldTypeSpec.create(oldField, newField);

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      const fieldIdStr = newField.id().toString();
      expect(visitor.valueChangedFields().map((id) => id.toString())).toEqual([fieldIdStr]);
      expect(visitor.selfBackfillFields().map((id) => id.toString())).toEqual([fieldIdStr]);
    });

    it('should not collect anything when types are the same and non-computed', () => {
      const oldField = createTextField('textC', 'Text', 'text_col')._unsafeUnwrap();
      const newField = createTextField('textC', 'Text Renamed', 'text_col')._unsafeUnwrap();
      const spec = TableUpdateFieldTypeSpec.create(oldField, newField);

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.valueChangedFields()).toEqual([]);
      expect(visitor.selfBackfillFields()).toEqual([]);
    });

    it('should collect selfBackfill for same-type computed field definition change', () => {
      const expr1 = FormulaExpression.create('1 + 1')._unsafeUnwrap();
      const expr2 = FormulaExpression.create('2 + 2')._unsafeUnwrap();
      const oldField = createFormulaField({
        id: mkFieldId('fmlST'),
        name: mkFieldName('Formula'),
        expression: expr1,
      })._unsafeUnwrap();
      const newField = createFormulaField({
        id: mkFieldId('fmlST'),
        name: mkFieldName('Formula'),
        expression: expr2,
      })._unsafeUnwrap();
      const spec = TableUpdateFieldTypeSpec.create(oldField, newField);

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      const fieldIdStr = newField.id().toString();
      expect(visitor.selfBackfillFields().map((id) => id.toString())).toEqual([fieldIdStr]);
      // Not a type conversion, so no valueChanged
      expect(visitor.valueChangedFields()).toEqual([]);
    });

    it('should detect hasDbStorageTypeChange when cellValueType changes (text -> number)', () => {
      const oldField = createTextField('typeChg', 'Text', 'text_col')._unsafeUnwrap();
      const newField = createNumField('typeChg', 'Number', 'text_col')._unsafeUnwrap();
      const spec = TableUpdateFieldTypeSpec.create(oldField, newField);

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      // text -> number changes cellValueType from 'string' to 'number'
      // which means the DB column type changes from text to double precision
      expect(visitor.hasDbStorageTypeChange()).toBe(true);
    });

    it('should not detect hasDbStorageTypeChange when cellValueType stays the same', () => {
      const oldField = createTextField('typeNoChg', 'Text A', 'text_col')._unsafeUnwrap();
      const newField = createTextField('typeNoChg', 'Text B', 'text_col')._unsafeUnwrap();
      const spec = TableUpdateFieldTypeSpec.create(oldField, newField);

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      // text -> text, no type conversion at all
      expect(visitor.hasDbStorageTypeChange()).toBe(false);
    });
  });

  // ============ UpdateRatingMaxSpec ============

  describe('visitUpdateRatingMax', () => {
    it('should collect valueChangedFieldIds when max is reducing', () => {
      const fieldId = mkFieldId('ratA');
      const dbFieldName = mkDbFieldName('rat_col');
      const spec = UpdateRatingMaxSpec.create(
        fieldId,
        dbFieldName,
        RatingMax.create(5)._unsafeUnwrap(),
        RatingMax.create(3)._unsafeUnwrap()
      );

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.valueChangedFields().map((id) => id.toString())).toEqual([fieldId.toString()]);
      expect(visitor.selfBackfillFields()).toEqual([]);
    });

    it('should not collect anything when max is increasing', () => {
      const fieldId = mkFieldId('ratB');
      const dbFieldName = mkDbFieldName('rat_col');
      const spec = UpdateRatingMaxSpec.create(
        fieldId,
        dbFieldName,
        RatingMax.create(3)._unsafeUnwrap(),
        RatingMax.create(5)._unsafeUnwrap()
      );

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.valueChangedFields()).toEqual([]);
      expect(visitor.selfBackfillFields()).toEqual([]);
    });
  });

  // ============ UpdateSingleSelectOptionsSpec ============

  describe('visitUpdateSingleSelectOptions', () => {
    it('should collect valueChangedFieldIds when options are renamed', () => {
      const fieldId = mkFieldId('selA');
      const dbFieldName = mkDbFieldName('sel_col');
      const optA = SelectOption.create({
        id: 'choAAAAAAAA',
        name: 'Red',
        color: 'red',
      })._unsafeUnwrap();
      const optARenamed = SelectOption.create({
        id: 'choAAAAAAAA',
        name: 'Crimson',
        color: 'red',
      })._unsafeUnwrap();

      const spec = UpdateSingleSelectOptionsSpec.create(
        fieldId,
        dbFieldName,
        [optA],
        [optARenamed]
      );

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.valueChangedFields().map((id) => id.toString())).toEqual([fieldId.toString()]);
    });

    it('should collect valueChangedFieldIds when options are removed', () => {
      const fieldId = mkFieldId('selB');
      const dbFieldName = mkDbFieldName('sel_col');
      const optA = SelectOption.create({
        id: 'choBBBBBBBB',
        name: 'Green',
        color: 'green',
      })._unsafeUnwrap();

      const spec = UpdateSingleSelectOptionsSpec.create(fieldId, dbFieldName, [optA], []);

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.valueChangedFields().map((id) => id.toString())).toEqual([fieldId.toString()]);
    });

    it('should not collect anything when only options are added', () => {
      const fieldId = mkFieldId('selC');
      const dbFieldName = mkDbFieldName('sel_col');
      const optA = SelectOption.create({
        id: 'choCCCCCCCC',
        name: 'Blue',
        color: 'blue',
      })._unsafeUnwrap();
      const optB = SelectOption.create({ name: 'Yellow', color: 'yellow' })._unsafeUnwrap();

      const spec = UpdateSingleSelectOptionsSpec.create(fieldId, dbFieldName, [optA], [optA, optB]);

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.valueChangedFields()).toEqual([]);
      expect(visitor.selfBackfillFields()).toEqual([]);
    });
  });

  // ============ UpdateMultipleSelectOptionsSpec ============

  describe('visitUpdateMultipleSelectOptions', () => {
    it('should collect valueChangedFieldIds when options are renamed', () => {
      const fieldId = mkFieldId('mselA');
      const dbFieldName = mkDbFieldName('msel_col');
      const optA = SelectOption.create({
        id: 'choDDDDDDDD',
        name: 'Alpha',
        color: 'red',
      })._unsafeUnwrap();
      const optARenamed = SelectOption.create({
        id: 'choDDDDDDDD',
        name: 'Beta',
        color: 'red',
      })._unsafeUnwrap();

      const spec = UpdateMultipleSelectOptionsSpec.create(
        fieldId,
        dbFieldName,
        [optA],
        [optARenamed]
      );

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.valueChangedFields().map((id) => id.toString())).toEqual([fieldId.toString()]);
    });

    it('should collect valueChangedFieldIds when options are removed', () => {
      const fieldId = mkFieldId('mselB');
      const dbFieldName = mkDbFieldName('msel_col');
      const optA = SelectOption.create({
        id: 'choEEEEEEEE',
        name: 'One',
        color: 'blue',
      })._unsafeUnwrap();

      const spec = UpdateMultipleSelectOptionsSpec.create(fieldId, dbFieldName, [optA], []);

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.valueChangedFields().map((id) => id.toString())).toEqual([fieldId.toString()]);
    });
  });

  // ============ UpdateFormulaExpressionSpec ============

  describe('visitUpdateFormulaExpression', () => {
    it('should collect selfBackfillFieldIds and valueChangedFieldIds', () => {
      const fieldId = mkFieldId('fmlA');
      const prev = FormulaExpression.create('1 + 1')._unsafeUnwrap();
      const next = FormulaExpression.create('2 + 2')._unsafeUnwrap();
      const spec = UpdateFormulaExpressionSpec.create(fieldId, prev, next);

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.selfBackfillFields().map((id) => id.toString())).toEqual([fieldId.toString()]);
      expect(visitor.valueChangedFields().map((id) => id.toString())).toEqual([fieldId.toString()]);
    });
  });

  // ============ Link Update specs ============

  describe('visitUpdateLinkConfig', () => {
    it('should collect selfBackfillFieldIds when lookupFieldId changes', () => {
      const fieldId = mkFieldId('lnkCfgA');
      const previousConfig = mkLinkConfig({
        relationship: 'oneOne',
        foreignTableId: `tbl${'a'.repeat(16)}`,
        lookupFieldId: createValidFieldId('lookA'),
      });
      const nextConfig = mkLinkConfig({
        relationship: 'oneOne',
        foreignTableId: `tbl${'a'.repeat(16)}`,
        lookupFieldId: createValidFieldId('lookB'),
      });
      const spec = UpdateLinkConfigSpec.create(fieldId, previousConfig, nextConfig);

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.valueChangedFields()).toEqual([]);
      expect(visitor.selfBackfillFields().map((id) => id.toString())).toEqual([fieldId.toString()]);
    });

    it('should not collect valueChangedFieldIds for filter-only changes', () => {
      const fieldId = mkFieldId('lnkCfgB');
      const previousConfig = mkLinkConfig({
        relationship: 'manyMany',
        foreignTableId: `tbl${'b'.repeat(16)}`,
        lookupFieldId: createValidFieldId('lookC'),
        symmetricFieldId: createValidFieldId('symAA'),
      });
      const nextConfig = mkLinkConfig({
        relationship: 'manyMany',
        foreignTableId: `tbl${'b'.repeat(16)}`,
        lookupFieldId: createValidFieldId('lookC'),
        symmetricFieldId: createValidFieldId('symAA'),
        filter: {
          conjunction: 'and',
          filterSet: [],
        },
      });
      const spec = UpdateLinkConfigSpec.create(fieldId, previousConfig, nextConfig);

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.valueChangedFields()).toEqual([]);
      expect(visitor.selfBackfillFields()).toEqual([]);
    });

    it('should not collect valueChangedFieldIds when relationship changes', () => {
      const fieldId = mkFieldId('lnkCfgRel');
      const previousConfig = mkLinkConfig({
        relationship: 'manyMany',
        foreignTableId: `tbl${'i'.repeat(16)}`,
        lookupFieldId: createValidFieldId('lookRel'),
        isOneWay: false,
        symmetricFieldId: createValidFieldId('symRel'),
      });
      const nextConfig = mkLinkConfig({
        relationship: 'oneMany',
        foreignTableId: `tbl${'i'.repeat(16)}`,
        lookupFieldId: createValidFieldId('lookRel'),
        isOneWay: false,
        symmetricFieldId: createValidFieldId('symRel'),
      });
      const spec = UpdateLinkConfigSpec.create(fieldId, previousConfig, nextConfig);

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.valueChangedFields()).toEqual([]);
    });

    it('should not collect valueChangedFieldIds when oneWay changes', () => {
      const fieldId = mkFieldId('lnkCfgOneWay');
      const previousConfig = mkLinkConfig({
        relationship: 'oneMany',
        foreignTableId: `tbl${'j'.repeat(16)}`,
        lookupFieldId: createValidFieldId('lookOneWay'),
        isOneWay: true,
        symmetricFieldId: createValidFieldId('symOneWay'),
      });
      const nextConfig = mkLinkConfig({
        relationship: 'oneMany',
        foreignTableId: `tbl${'j'.repeat(16)}`,
        lookupFieldId: createValidFieldId('lookOneWay'),
        isOneWay: false,
        symmetricFieldId: createValidFieldId('symOneWay'),
      });
      const spec = UpdateLinkConfigSpec.create(fieldId, previousConfig, nextConfig);

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.valueChangedFields()).toEqual([]);
    });
  });

  describe('visitUpdateLinkRelationship', () => {
    it('should not collect valueChangedFieldIds for relationship type conversion', () => {
      const fieldId = mkFieldId('lnkRelA');
      const dbFieldName = mkDbFieldName('link_col');
      const symmetricFieldId = mkFieldId('symBB');
      const previousConfig = mkLinkConfig({
        relationship: 'manyMany',
        foreignTableId: `tbl${'c'.repeat(16)}`,
        lookupFieldId: createValidFieldId('lookD'),
        isOneWay: false,
        symmetricFieldId: symmetricFieldId.toString(),
        fkHostTableName: `bse${'d'.repeat(16)}.junction_${createValidFieldId('srcAA')}`,
        selfKeyName: `__fk_${createValidFieldId('symBB')}`,
        foreignKeyName: `__fk_${createValidFieldId('srcAA')}`,
      });
      const nextConfig = mkLinkConfig({
        relationship: 'manyOne',
        foreignTableId: `tbl${'c'.repeat(16)}`,
        lookupFieldId: createValidFieldId('lookD'),
        isOneWay: false,
        symmetricFieldId: symmetricFieldId.toString(),
        fkHostTableName: `bse${'d'.repeat(16)}.tbl${'e'.repeat(16)}`,
        selfKeyName: '__id',
        foreignKeyName: `__fk_${createValidFieldId('srcAA')}`,
      });
      const spec = UpdateLinkRelationshipSpec.create({
        fieldId,
        dbFieldName,
        previousConfig,
        nextConfig,
      });

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.valueChangedFields()).toEqual([]);
      expect(visitor.selfBackfillFields()).toEqual([]);
      expect(visitor.deferredBackfillFields().map((id) => id.toString())).toEqual([
        fieldId.toString(),
      ]);
    });

    it('should not collect valueChangedFieldIds for one-way to two-way conversion', () => {
      const fieldId = mkFieldId('lnkRelOwTw');
      const dbFieldName = mkDbFieldName('link_col');
      const symmetricFieldId = mkFieldId('symOwTw');
      const previousConfig = mkLinkConfig({
        relationship: 'oneMany',
        foreignTableId: `tbl${'f'.repeat(16)}`,
        lookupFieldId: createValidFieldId('lookOwTw'),
        isOneWay: true,
        symmetricFieldId: symmetricFieldId.toString(),
        fkHostTableName: `bse${'g'.repeat(16)}.junction_${createValidFieldId('srcOwTw')}`,
        selfKeyName: `__fk_${createValidFieldId('symOwTw')}`,
        foreignKeyName: `__fk_${createValidFieldId('srcOwTw')}`,
      });
      const nextConfig = mkLinkConfig({
        relationship: 'oneMany',
        foreignTableId: `tbl${'f'.repeat(16)}`,
        lookupFieldId: createValidFieldId('lookOwTw'),
        isOneWay: false,
        symmetricFieldId: symmetricFieldId.toString(),
        fkHostTableName: `bse${'g'.repeat(16)}.tbl${'h'.repeat(16)}`,
        selfKeyName: `__fk_${createValidFieldId('symOwTw')}`,
        foreignKeyName: '__id',
      });
      const spec = UpdateLinkRelationshipSpec.create({
        fieldId,
        dbFieldName,
        previousConfig,
        nextConfig,
      });

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.valueChangedFields()).toEqual([]);
      expect(visitor.selfBackfillFields()).toEqual([]);
      expect(visitor.deferredBackfillFields().map((id) => id.toString())).toEqual([
        fieldId.toString(),
      ]);
    });
  });

  // ============ UpdateLookupOptionsSpec ============

  describe('visitUpdateLookupOptions', () => {
    it('should collect selfBackfillFieldIds and detect dbStorageTypeChange when lookupFieldId changes', () => {
      const fieldId = mkFieldId('lkpA');
      const prevOptions = LookupOptions.create({
        linkFieldId: createValidFieldId('linkA'),
        lookupFieldId: createValidFieldId('lookA'),
        foreignTableId: `tbl${'a'.repeat(16)}`,
      })._unsafeUnwrap();
      const nextOptions = LookupOptions.create({
        linkFieldId: createValidFieldId('linkA'),
        lookupFieldId: createValidFieldId('lookB'),
        foreignTableId: `tbl${'a'.repeat(16)}`,
      })._unsafeUnwrap();
      const spec = UpdateLookupOptionsSpec.create(fieldId, prevOptions, nextOptions);

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.selfBackfillFields().map((id) => id.toString())).toEqual([fieldId.toString()]);
      expect(visitor.valueChangedFields()).toEqual([]);
      expect(visitor.hasDbStorageTypeChange()).toBe(true);
    });

    it('should not detect dbStorageTypeChange when only filter changes', () => {
      const fieldId = mkFieldId('lkpB');
      const prevOptions = LookupOptions.create({
        linkFieldId: createValidFieldId('linkA'),
        lookupFieldId: createValidFieldId('lookA'),
        foreignTableId: `tbl${'a'.repeat(16)}`,
      })._unsafeUnwrap();
      const nextOptions = LookupOptions.create({
        linkFieldId: createValidFieldId('linkA'),
        lookupFieldId: createValidFieldId('lookA'),
        foreignTableId: `tbl${'a'.repeat(16)}`,
        filter: { conjunction: 'and', filterSet: [] },
      })._unsafeUnwrap();
      const spec = UpdateLookupOptionsSpec.create(fieldId, prevOptions, nextOptions);

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.selfBackfillFields().map((id) => id.toString())).toEqual([fieldId.toString()]);
      expect(visitor.hasDbStorageTypeChange()).toBe(false);
    });
  });

  // ============ UpdateRollupConfigSpec ============

  describe('visitUpdateRollupConfig', () => {
    it('should collect selfBackfillFieldIds', () => {
      const fieldId = mkFieldId('rlpA');
      const prevConfig = RollupFieldConfig.create({
        linkFieldId: createValidFieldId('linkA'),
        lookupFieldId: createValidFieldId('lookA'),
        foreignTableId: `tbl${'a'.repeat(16)}`,
      })._unsafeUnwrap();
      const nextConfig = RollupFieldConfig.create({
        linkFieldId: createValidFieldId('linkA'),
        lookupFieldId: createValidFieldId('lookB'),
        foreignTableId: `tbl${'a'.repeat(16)}`,
      })._unsafeUnwrap();
      const spec = UpdateRollupConfigSpec.create(fieldId, prevConfig, nextConfig);

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.selfBackfillFields().map((id) => id.toString())).toEqual([fieldId.toString()]);
      expect(visitor.valueChangedFields()).toEqual([]);
    });
  });

  // ============ UpdateRollupExpressionSpec ============

  describe('visitUpdateRollupExpression', () => {
    it('should collect selfBackfillFieldIds', () => {
      const fieldId = mkFieldId('rlpB');
      const prev = RollupExpression.create('sum({values})')._unsafeUnwrap();
      const next = RollupExpression.create('average({values})')._unsafeUnwrap();
      const spec = UpdateRollupExpressionSpec.create(fieldId, prev, next);

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.selfBackfillFields().map((id) => id.toString())).toEqual([fieldId.toString()]);
      expect(visitor.valueChangedFields()).toEqual([]);
    });
  });

  // ============ UpdateUserMultiplicitySpec ============

  describe('visitUpdateUserMultiplicity', () => {
    it('should collect valueChangedFieldIds', () => {
      const fieldId = mkFieldId('usrA');
      const dbFieldName = mkDbFieldName('usr_col');
      const spec = UpdateUserMultiplicitySpec.create(
        fieldId,
        dbFieldName,
        UserMultiplicity.single(),
        UserMultiplicity.multiple()
      );

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.valueChangedFields().map((id) => id.toString())).toEqual([fieldId.toString()]);
      expect(visitor.selfBackfillFields()).toEqual([]);
    });
  });

  // ============ Non-value-changing spec ============

  describe('visitTableUpdateFieldName', () => {
    it('should not collect anything', () => {
      const fieldId = mkFieldId('nameA');
      const spec = TableUpdateFieldNameSpec.create(fieldId, mkFieldName('Old'), mkFieldName('New'));

      const visitor = new FieldValueChangeCollectorVisitor();
      spec.accept(visitor);

      expect(visitor.valueChangedFields()).toEqual([]);
      expect(visitor.selfBackfillFields()).toEqual([]);
    });
  });

  // ============ Deduplication ============

  describe('deduplication', () => {
    it('should deduplicate field IDs across multiple specs', () => {
      const fieldId = mkFieldId('dedupA');
      const prev = FormulaExpression.create('1')._unsafeUnwrap();
      const next = FormulaExpression.create('2')._unsafeUnwrap();

      const visitor = new FieldValueChangeCollectorVisitor();

      // Accept the same field twice via two different formula expression specs
      const spec1 = UpdateFormulaExpressionSpec.create(fieldId, prev, next);
      spec1.accept(visitor);

      const spec2 = UpdateFormulaExpressionSpec.create(fieldId, next, prev);
      spec2.accept(visitor);

      // Should only appear once
      expect(visitor.selfBackfillFields()).toHaveLength(1);
      expect(visitor.selfBackfillFields()[0].toString()).toBe(fieldId.toString());
    });
  });
});
