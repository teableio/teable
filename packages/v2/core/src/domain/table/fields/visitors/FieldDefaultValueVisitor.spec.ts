import { describe, expect, it } from 'vitest';

import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { CheckboxDefaultValue } from '../types/CheckboxDefaultValue';
import { CheckboxField } from '../types/CheckboxField';
import { DateDefaultValue } from '../types/DateDefaultValue';
import { DateField } from '../types/DateField';
import { FormulaExpression } from '../types/FormulaExpression';
import { FormulaField } from '../types/FormulaField';
import { LongTextField } from '../types/LongTextField';
import { MultipleSelectField } from '../types/MultipleSelectField';
import { NumberDefaultValue } from '../types/NumberDefaultValue';
import { NumberField } from '../types/NumberField';
import { RatingField } from '../types/RatingField';
import { SelectDefaultValue } from '../types/SelectDefaultValue';
import { SelectOption } from '../types/SelectOption';
import { SingleLineTextField } from '../types/SingleLineTextField';
import { SingleSelectField } from '../types/SingleSelectField';
import { TextDefaultValue } from '../types/TextDefaultValue';
import { FieldDefaultValueVisitor } from './FieldDefaultValueVisitor';

const createFieldId = (seed: string) =>
  FieldId.create(`fld${seed.padEnd(16, '0').slice(0, 16)}`)._unsafeUnwrap();
const createFieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();

describe('FieldDefaultValueVisitor', () => {
  const visitor = FieldDefaultValueVisitor.create();

  describe('visitSingleLineTextField', () => {
    it('returns default value when configured', () => {
      const field = SingleLineTextField.create({
        id: createFieldId('a'),
        name: createFieldName('Title'),
        defaultValue: TextDefaultValue.create('Default Title')._unsafeUnwrap(),
      })._unsafeUnwrap();

      const result = field.accept(visitor);
      expect(result._unsafeUnwrap()).toBe('Default Title');
    });

    it('returns undefined when no default value configured', () => {
      const field = SingleLineTextField.create({
        id: createFieldId('b'),
        name: createFieldName('Title'),
      })._unsafeUnwrap();

      const result = field.accept(visitor);
      expect(result._unsafeUnwrap()).toBeUndefined();
    });
  });

  describe('visitLongTextField', () => {
    it('returns default value when configured', () => {
      const field = LongTextField.create({
        id: createFieldId('c'),
        name: createFieldName('Description'),
        defaultValue: TextDefaultValue.create('Default Description')._unsafeUnwrap(),
      })._unsafeUnwrap();

      const result = field.accept(visitor);
      expect(result._unsafeUnwrap()).toBe('Default Description');
    });

    it('returns undefined when no default value configured', () => {
      const field = LongTextField.create({
        id: createFieldId('d'),
        name: createFieldName('Description'),
      })._unsafeUnwrap();

      const result = field.accept(visitor);
      expect(result._unsafeUnwrap()).toBeUndefined();
    });
  });

  describe('visitNumberField', () => {
    it('returns default value when configured', () => {
      const field = NumberField.create({
        id: createFieldId('e'),
        name: createFieldName('Amount'),
        defaultValue: NumberDefaultValue.create(100)._unsafeUnwrap(),
      })._unsafeUnwrap();

      const result = field.accept(visitor);
      expect(result._unsafeUnwrap()).toBe(100);
    });

    it('returns undefined when no default value configured', () => {
      const field = NumberField.create({
        id: createFieldId('f'),
        name: createFieldName('Amount'),
      })._unsafeUnwrap();

      const result = field.accept(visitor);
      expect(result._unsafeUnwrap()).toBeUndefined();
    });
  });

  describe('visitCheckboxField', () => {
    it('returns true when default value is true', () => {
      const field = CheckboxField.create({
        id: createFieldId('g'),
        name: createFieldName('Enabled'),
        defaultValue: CheckboxDefaultValue.create(true)._unsafeUnwrap(),
      })._unsafeUnwrap();

      const result = field.accept(visitor);
      expect(result._unsafeUnwrap()).toBe(true);
    });

    it('returns false when default value is false', () => {
      const field = CheckboxField.create({
        id: createFieldId('h'),
        name: createFieldName('Disabled'),
        defaultValue: CheckboxDefaultValue.create(false)._unsafeUnwrap(),
      })._unsafeUnwrap();

      const result = field.accept(visitor);
      expect(result._unsafeUnwrap()).toBe(false);
    });

    it('returns undefined when no default value configured', () => {
      const field = CheckboxField.create({
        id: createFieldId('i'),
        name: createFieldName('Check'),
      })._unsafeUnwrap();

      const result = field.accept(visitor);
      expect(result._unsafeUnwrap()).toBeUndefined();
    });
  });

  describe('visitRatingField', () => {
    it('returns undefined (rating has no default)', () => {
      const field = RatingField.create({
        id: createFieldId('j'),
        name: createFieldName('Rating'),
      })._unsafeUnwrap();

      const result = field.accept(visitor);
      expect(result._unsafeUnwrap()).toBeUndefined();
    });
  });

  describe('visitSingleSelectField', () => {
    it('returns option name when default value is configured', () => {
      const options = [
        SelectOption.create({ id: 'opt1', name: 'Option 1', color: 'red' })._unsafeUnwrap(),
        SelectOption.create({ id: 'opt2', name: 'Option 2', color: 'blue' })._unsafeUnwrap(),
      ];
      const field = SingleSelectField.create({
        id: createFieldId('k'),
        name: createFieldName('Status'),
        options,
        defaultValue: SelectDefaultValue.create('Option 1')._unsafeUnwrap(),
      })._unsafeUnwrap();

      const result = field.accept(visitor);
      // Default values are stored as option names
      expect(result._unsafeUnwrap()).toBe('Option 1');
    });

    it('returns undefined when no default value configured', () => {
      const options = [
        SelectOption.create({ id: 'opt1', name: 'Option 1', color: 'red' })._unsafeUnwrap(),
      ];
      const field = SingleSelectField.create({
        id: createFieldId('l'),
        name: createFieldName('Status'),
        options,
      })._unsafeUnwrap();

      const result = field.accept(visitor);
      expect(result._unsafeUnwrap()).toBeUndefined();
    });

    // Note: validateSelectOptions prevents creating fields with non-existent default values,
    // so the "returns undefined for non-existent option" case is a runtime safety net
    // that cannot be directly tested via normal field creation.
  });

  describe('visitMultipleSelectField', () => {
    it('returns option names when default value is configured', () => {
      const options = [
        SelectOption.create({ id: 'opt1', name: 'Option 1', color: 'red' })._unsafeUnwrap(),
        SelectOption.create({ id: 'opt2', name: 'Option 2', color: 'blue' })._unsafeUnwrap(),
        SelectOption.create({ id: 'opt3', name: 'Option 3', color: 'green' })._unsafeUnwrap(),
      ];
      const field = MultipleSelectField.create({
        id: createFieldId('ms1'),
        name: createFieldName('Tags'),
        options,
        defaultValue: SelectDefaultValue.create(['Option 1', 'Option 3'])._unsafeUnwrap(),
      })._unsafeUnwrap();

      const result = field.accept(visitor);
      // Default values are stored as option names
      expect(result._unsafeUnwrap()).toEqual(['Option 1', 'Option 3']);
    });

    it('returns undefined when no default value configured', () => {
      const options = [
        SelectOption.create({ id: 'opt1', name: 'Option 1', color: 'red' })._unsafeUnwrap(),
      ];
      const field = MultipleSelectField.create({
        id: createFieldId('ms2'),
        name: createFieldName('Tags'),
        options,
      })._unsafeUnwrap();

      const result = field.accept(visitor);
      expect(result._unsafeUnwrap()).toBeUndefined();
    });

    // Note: validateSelectOptions prevents creating fields with non-existent default values,
    // so edge cases like "filters out non-existent options" are runtime safety nets
    // that cannot be directly tested via normal field creation.
  });

  describe('visitDateField', () => {
    it('returns current date ISO string when default value is "now"', () => {
      const field = DateField.create({
        id: createFieldId('dt1'),
        name: createFieldName('Created'),
        defaultValue: DateDefaultValue.create('now')._unsafeUnwrap(),
      })._unsafeUnwrap();

      const result = field.accept(visitor);
      const value = result._unsafeUnwrap();
      expect(typeof value).toBe('string');
      // Verify it's a valid ISO date string
      expect(new Date(value as string).toISOString()).toBe(value);
    });

    it('returns undefined when no default value configured', () => {
      const field = DateField.create({
        id: createFieldId('dt2'),
        name: createFieldName('Date'),
      })._unsafeUnwrap();

      const result = field.accept(visitor);
      expect(result._unsafeUnwrap()).toBeUndefined();
    });
  });

  describe('computed fields', () => {
    it('returns undefined for formula field', () => {
      const field = FormulaField.create({
        id: createFieldId('o'),
        name: createFieldName('Formula'),
        expression: FormulaExpression.create('1 + 1')._unsafeUnwrap(),
      })._unsafeUnwrap();

      const result = field.accept(visitor);
      expect(result._unsafeUnwrap()).toBeUndefined();
    });
  });
});
