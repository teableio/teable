import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../../base/BaseId';
import type { ISpecification } from '../../../../shared/specification/ISpecification';
import { FieldId } from '../../../fields/FieldId';
import { FieldName } from '../../../fields/FieldName';
import { DbFieldName } from '../../../fields/DbFieldName';
import { DateField } from '../../../fields/types/DateField';
import { DateTimeFormatting, TimeFormatting } from '../../../fields/types/DateTimeFormatting';
import { FormulaExpression } from '../../../fields/types/FormulaExpression';
import { FormulaField } from '../../../fields/types/FormulaField';
import { NumberField } from '../../../fields/types/NumberField';
import { NumberFormatting, NumberFormattingType } from '../../../fields/types/NumberFormatting';
import { SelectOption } from '../../../fields/types/SelectOption';
import { SingleSelectField } from '../../../fields/types/SingleSelectField';
import { Table } from '../../../Table';
import { TableName } from '../../../TableName';
import type { ITableSpecVisitor } from '../../ITableSpecVisitor';
import { UpdateDateFormattingSpec } from '../UpdateDateFormattingSpec';
import { UpdateFormulaExpressionSpec } from '../UpdateFormulaExpressionSpec';
import { UpdateNumberFormattingSpec } from '../UpdateNumberFormattingSpec';
import { UpdateSingleSelectOptionsSpec } from '../UpdateSingleSelectOptionsSpec';

// Minimal spy visitor that tracks which visit methods are called
class SpyVisitor
  implements
    Pick<
      ITableSpecVisitor,
      | 'visit'
      | 'visitUpdateFormulaExpression'
      | 'visitUpdateNumberFormatting'
      | 'visitUpdateSingleSelectOptions'
      | 'visitUpdateDateFormatting'
    >
{
  readonly calls: string[] = [];

  visit(_: ISpecification<unknown, ITableSpecVisitor>) {
    return ok(undefined);
  }

  visitUpdateFormulaExpression(_: any) {
    this.calls.push('UpdateFormulaExpressionSpec');
    return ok(undefined);
  }

  visitUpdateNumberFormatting(_: any) {
    this.calls.push('UpdateNumberFormattingSpec');
    return ok(undefined);
  }

  visitUpdateSingleSelectOptions(_: any) {
    this.calls.push('UpdateSingleSelectOptionsSpec');
    return ok(undefined);
  }

  visitUpdateDateFormatting(_: any) {
    this.calls.push('UpdateDateFormattingSpec');
    return ok(undefined);
  }
}

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

const buildTableWithNumberField = (fieldId: FieldId) => {
  const baseId = createBaseId('a');
  const tableName = TableName.create('Test')._unsafeUnwrap();
  const primaryName = FieldName.create('Title')._unsafeUnwrap();
  const numberName = FieldName.create('Amount')._unsafeUnwrap();

  const builder = Table.builder().withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(primaryName).done();
  builder.field().number().withId(fieldId).withName(numberName).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildTableWithFormulaField = (fieldId: FieldId) => {
  const baseId = createBaseId('b');
  const tableName = TableName.create('Test')._unsafeUnwrap();
  const primaryName = FieldName.create('Title')._unsafeUnwrap();
  const formulaName = FieldName.create('Calc')._unsafeUnwrap();
  const expr = FormulaExpression.create('1')._unsafeUnwrap();

  const builder = Table.builder().withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(primaryName).done();
  builder.field().formula().withId(fieldId).withName(formulaName).withExpression(expr).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildTableWithSingleSelectField = (fieldId: FieldId, options: SelectOption[]) => {
  const baseId = createBaseId('c');
  const tableName = TableName.create('Test')._unsafeUnwrap();
  const primaryName = FieldName.create('Title')._unsafeUnwrap();
  const selectName = FieldName.create('Status')._unsafeUnwrap();

  const builder = Table.builder().withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(primaryName).done();
  builder.field().singleSelect().withId(fieldId).withName(selectName).withOptions(options).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildTableWithDateField = (fieldId: FieldId) => {
  const baseId = createBaseId('d');
  const tableName = TableName.create('Test')._unsafeUnwrap();
  const primaryName = FieldName.create('Title')._unsafeUnwrap();
  const dateName = FieldName.create('Due')._unsafeUnwrap();

  const builder = Table.builder().withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(primaryName).done();
  builder.field().date().withId(fieldId).withName(dateName).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('Field update specs', () => {
  describe('UpdateNumberFormattingSpec', () => {
    it('mutates table to update number formatting', () => {
      const fieldId = createFieldId('1');
      const table = buildTableWithNumberField(fieldId);

      const prevFormatting = NumberFormatting.default();
      const nextFormatting = NumberFormatting.create({
        type: NumberFormattingType.Percent,
        precision: 1,
      })._unsafeUnwrap();

      const spec = UpdateNumberFormattingSpec.create(fieldId, prevFormatting, nextFormatting);

      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousFormatting()).toBe(prevFormatting);
      expect(spec.nextFormatting()).toBe(nextFormatting);
      expect(spec.isSatisfiedBy(table)).toBe(true);

      const result = spec.mutate(table);
      const updatedTable = result._unsafeUnwrap();

      const updatedField = updatedTable.getField((f) => f.id().equals(fieldId))._unsafeUnwrap();
      expect(updatedField).toBeInstanceOf(NumberField);
    });

    it('errors when field not found', () => {
      const fieldId = createFieldId('2');
      const missingId = createFieldId('z');
      const table = buildTableWithNumberField(fieldId);

      const spec = UpdateNumberFormattingSpec.create(
        missingId,
        NumberFormatting.default(),
        NumberFormatting.default()
      );

      const result = spec.mutate(table);
      result._unsafeUnwrapErr();
    });

    it('errors when field is wrong type', () => {
      const fieldId = createFieldId('3');
      const table = buildTableWithDateField(fieldId);

      const spec = UpdateNumberFormattingSpec.create(
        fieldId,
        NumberFormatting.default(),
        NumberFormatting.default()
      );

      const result = spec.mutate(table);
      const error = result._unsafeUnwrapErr();
      expect(error.message).toContain('not a number field');
    });

    it('accepts visitor', () => {
      const fieldId = createFieldId('4');
      const spec = UpdateNumberFormattingSpec.create(
        fieldId,
        NumberFormatting.default(),
        NumberFormatting.default()
      );

      const visitor = new SpyVisitor();
      spec.accept(visitor as any)._unsafeUnwrap();
      expect(visitor.calls).toContain('UpdateNumberFormattingSpec');
    });
  });

  describe('UpdateFormulaExpressionSpec', () => {
    it('mutates table to update formula expression', () => {
      const fieldId = createFieldId('5');
      const table = buildTableWithFormulaField(fieldId);

      const prevExpr = FormulaExpression.create('1')._unsafeUnwrap();
      const nextExpr = FormulaExpression.create('2 + 2')._unsafeUnwrap();

      const spec = UpdateFormulaExpressionSpec.create(fieldId, prevExpr, nextExpr);

      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousExpression()).toBe(prevExpr);
      expect(spec.nextExpression()).toBe(nextExpr);

      const result = spec.mutate(table);
      const updatedTable = result._unsafeUnwrap();

      const updatedField = updatedTable.getField((f) => f.id().equals(fieldId))._unsafeUnwrap();
      expect(updatedField).toBeInstanceOf(FormulaField);
    });

    it('errors when field is not a formula field', () => {
      const fieldId = createFieldId('6');
      const table = buildTableWithNumberField(fieldId);

      const prevExpr = FormulaExpression.create('1')._unsafeUnwrap();
      const nextExpr = FormulaExpression.create('2')._unsafeUnwrap();

      const spec = UpdateFormulaExpressionSpec.create(fieldId, prevExpr, nextExpr);
      const result = spec.mutate(table);
      const error = result._unsafeUnwrapErr();
      expect(error.message).toContain('not a formula field');
    });

    it('accepts visitor', () => {
      const fieldId = createFieldId('7');
      const prevExpr = FormulaExpression.create('1')._unsafeUnwrap();
      const nextExpr = FormulaExpression.create('2')._unsafeUnwrap();

      const spec = UpdateFormulaExpressionSpec.create(fieldId, prevExpr, nextExpr);
      const visitor = new SpyVisitor();
      spec.accept(visitor as any)._unsafeUnwrap();
      expect(visitor.calls).toContain('UpdateFormulaExpressionSpec');
    });
  });

  describe('UpdateSingleSelectOptionsSpec', () => {
    it('mutates table to update options', () => {
      const fieldId = createFieldId('8');
      const opt1 = SelectOption.create({ name: 'Todo', color: 'blue' })._unsafeUnwrap();
      const opt2 = SelectOption.create({ name: 'Done', color: 'green' })._unsafeUnwrap();
      const opt3 = SelectOption.create({ name: 'InProgress', color: 'yellow' })._unsafeUnwrap();

      const table = buildTableWithSingleSelectField(fieldId, [opt1, opt2]);

      const dbFieldName = DbFieldName.rehydrate('fld_status')._unsafeUnwrap();
      const spec = UpdateSingleSelectOptionsSpec.create(
        fieldId,
        dbFieldName,
        [opt1, opt2],
        [opt1, opt3]
      );

      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousOptions()).toEqual([opt1, opt2]);
      expect(spec.nextOptions()).toEqual([opt1, opt3]);

      const result = spec.mutate(table);
      const updatedTable = result._unsafeUnwrap();
      const updatedField = updatedTable.getField((f) => f.id().equals(fieldId))._unsafeUnwrap();
      expect(updatedField).toBeInstanceOf(SingleSelectField);
    });

    it('detects added options', () => {
      const fieldId = createFieldId('9');
      const opt1 = SelectOption.create({ name: 'A', color: 'blue' })._unsafeUnwrap();
      const opt2 = SelectOption.create({ name: 'B', color: 'green' })._unsafeUnwrap();
      const dbFieldName = DbFieldName.rehydrate('fld_test')._unsafeUnwrap();

      const spec = UpdateSingleSelectOptionsSpec.create(fieldId, dbFieldName, [opt1], [opt1, opt2]);
      expect(spec.addedOptions().length).toBe(1);
      expect(spec.removedOptions().length).toBe(0);
    });

    it('detects removed options', () => {
      const fieldId = createFieldId('a');
      const opt1 = SelectOption.create({ name: 'A', color: 'blue' })._unsafeUnwrap();
      const opt2 = SelectOption.create({ name: 'B', color: 'green' })._unsafeUnwrap();
      const dbFieldName = DbFieldName.rehydrate('fld_test')._unsafeUnwrap();

      const spec = UpdateSingleSelectOptionsSpec.create(fieldId, dbFieldName, [opt1, opt2], [opt1]);
      expect(spec.removedOptions().length).toBe(1);
      expect(spec.addedOptions().length).toBe(0);
    });

    it('detects renamed options', () => {
      const fieldId = createFieldId('b');
      const opt1 = SelectOption.create({ id: 'opt1', name: 'Old', color: 'blue' })._unsafeUnwrap();
      const opt1Renamed = SelectOption.create({
        id: 'opt1',
        name: 'New',
        color: 'blue',
      })._unsafeUnwrap();
      const dbFieldName = DbFieldName.rehydrate('fld_test')._unsafeUnwrap();

      const spec = UpdateSingleSelectOptionsSpec.create(
        fieldId,
        dbFieldName,
        [opt1],
        [opt1Renamed]
      );
      expect(spec.renamedOptions().length).toBe(1);
      expect(spec.renamedOptions()[0].previous.name().toString()).toBe('Old');
      expect(spec.renamedOptions()[0].next.name().toString()).toBe('New');
    });

    it('detects modified options (any property change)', () => {
      const fieldId = createFieldId('c');
      const opt1 = SelectOption.create({ id: 'opt1', name: 'A', color: 'blue' })._unsafeUnwrap();
      const opt1Modified = SelectOption.create({
        id: 'opt1',
        name: 'A',
        color: 'green',
      })._unsafeUnwrap();
      const dbFieldName = DbFieldName.rehydrate('fld_test')._unsafeUnwrap();

      const spec = UpdateSingleSelectOptionsSpec.create(
        fieldId,
        dbFieldName,
        [opt1],
        [opt1Modified]
      );
      expect(spec.modifiedOptions().length).toBe(1);
    });

    it('errors when field is wrong type', () => {
      const fieldId = createFieldId('e');
      const table = buildTableWithNumberField(fieldId);
      const dbFieldName = DbFieldName.rehydrate('fld_test')._unsafeUnwrap();

      const spec = UpdateSingleSelectOptionsSpec.create(fieldId, dbFieldName, [], []);
      const result = spec.mutate(table);
      result._unsafeUnwrapErr();
    });

    it('accepts visitor', () => {
      const fieldId = createFieldId('f');
      const dbFieldName = DbFieldName.rehydrate('fld_test')._unsafeUnwrap();
      const spec = UpdateSingleSelectOptionsSpec.create(fieldId, dbFieldName, [], []);
      const visitor = new SpyVisitor();
      spec.accept(visitor as any)._unsafeUnwrap();
      expect(visitor.calls).toContain('UpdateSingleSelectOptionsSpec');
    });
  });

  describe('UpdateDateFormattingSpec', () => {
    it('mutates table to update date formatting', () => {
      const fieldId = createFieldId('g');
      const table = buildTableWithDateField(fieldId);

      const prevFormatting = DateTimeFormatting.default();
      const nextFormatting = DateTimeFormatting.create({
        date: 'YYYY/MM/DD',
        time: TimeFormatting.Hour24,
        timeZone: 'utc',
      })._unsafeUnwrap();

      const spec = UpdateDateFormattingSpec.create(fieldId, prevFormatting, nextFormatting);

      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousFormatting()).toBe(prevFormatting);
      expect(spec.nextFormatting()).toBe(nextFormatting);

      const result = spec.mutate(table);
      const updatedTable = result._unsafeUnwrap();
      const updatedField = updatedTable.getField((f) => f.id().equals(fieldId))._unsafeUnwrap();
      expect(updatedField).toBeInstanceOf(DateField);
    });

    it('errors when field is wrong type', () => {
      const fieldId = createFieldId('h');
      const table = buildTableWithNumberField(fieldId);

      const spec = UpdateDateFormattingSpec.create(
        fieldId,
        DateTimeFormatting.default(),
        DateTimeFormatting.default()
      );

      const result = spec.mutate(table);
      const error = result._unsafeUnwrapErr();
      expect(error.message).toContain('not a date field');
    });

    it('accepts visitor', () => {
      const fieldId = createFieldId('i');
      const spec = UpdateDateFormattingSpec.create(
        fieldId,
        DateTimeFormatting.default(),
        DateTimeFormatting.default()
      );

      const visitor = new SpyVisitor();
      spec.accept(visitor as any)._unsafeUnwrap();
      expect(visitor.calls).toContain('UpdateDateFormattingSpec');
    });
  });
});
