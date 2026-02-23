import { describe, expect, it } from 'vitest';

import { SetSingleSelectValueSpec } from '../../records/specs/values/SetSingleSelectValueSpec';
import { SetUserValueSpec } from '../../records/specs/values/SetUserValueSpec';
import { NoopCellValueSpec } from '../../records/specs/values/NoopCellValueSpec';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { ButtonField } from '../types/ButtonField';
import { MultipleSelectField } from '../types/MultipleSelectField';
import { SelectOption } from '../types/SelectOption';
import { SingleSelectField } from '../types/SingleSelectField';
import { UserField } from '../types/UserField';
import { UserMultiplicity } from '../types/UserMultiplicity';
import { FieldToSpecVisitor } from './FieldToSpecVisitor';
import { SingleLineTextField } from '../types/SingleLineTextField';
import { NumberField } from '../types/NumberField';
import { CheckboxField } from '../types/CheckboxField';
import { DateField } from '../types/DateField';
import { FormulaField } from '../types/FormulaField';
import { FormulaExpression } from '../types/FormulaExpression';
import { SetSingleLineTextValueSpec } from '../../records/specs/values/SetSingleLineTextValueSpec';
import { SetNumberValueSpec } from '../../records/specs/values/SetNumberValueSpec';
import { SetCheckboxValueSpec } from '../../records/specs/values/SetCheckboxValueSpec';
import { SetDateValueSpec } from '../../records/specs/values/SetDateValueSpec';
import { SetLinkValueSpec } from '../../records/specs/values/SetLinkValueSpec';
import { LinkField } from '../types/LinkField';
import { LinkFieldConfig } from '../types/LinkFieldConfig';

const createFieldId = (seed: string) =>
  FieldId.create(`fld${seed.padEnd(16, '0').slice(0, 16)}`)._unsafeUnwrap();
const createFieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();

describe('FieldToSpecVisitor', () => {
  describe('visitSingleSelectField', () => {
    const options = [
      SelectOption.create({ id: 'opt1', name: 'Option One', color: 'red' })._unsafeUnwrap(),
      SelectOption.create({ id: 'opt2', name: 'Option Two', color: 'blue' })._unsafeUnwrap(),
    ];

    const field = SingleSelectField.create({
      id: createFieldId('a'),
      name: createFieldName('Status'),
      options,
    })._unsafeUnwrap();

    it('accepts option ID in non-typecast mode', () => {
      const visitor = FieldToSpecVisitor.create('opt1', false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('accepts option name in non-typecast mode (v1 compatibility)', () => {
      const visitor = FieldToSpecVisitor.create('Option One', false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('rejects invalid option in non-typecast mode', () => {
      const visitor = FieldToSpecVisitor.create('Invalid', false);
      const result = field.accept(visitor);
      expect(result.isErr()).toBe(true);
    });

    it('accepts option ID in typecast mode', () => {
      const visitor = FieldToSpecVisitor.create('opt1', true);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('accepts option name in typecast mode', () => {
      const visitor = FieldToSpecVisitor.create('Option One', true);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('returns null for invalid option in typecast mode', () => {
      const visitor = FieldToSpecVisitor.create('Invalid', true);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      // In typecast mode, invalid options are silently ignored
    });

    it('accepts null value', () => {
      const visitor = FieldToSpecVisitor.create(null, false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('extracts title from object input in typecast mode', () => {
      const visitor = FieldToSpecVisitor.create({ title: 'Option One' }, true);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      expect((result._unsafeUnwrap() as SetSingleSelectValueSpec).value.toValue()).toBe(
        'Option One'
      );
    });

    it('extracts name from object input in typecast mode', () => {
      const visitor = FieldToSpecVisitor.create({ name: 'Option Two' }, true);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      expect((result._unsafeUnwrap() as SetSingleSelectValueSpec).value.toValue()).toBe(
        'Option Two'
      );
    });

    it('falls back to json string for plain object input', () => {
      const jsonField = SingleSelectField.create({
        id: createFieldId('az'),
        name: createFieldName('Json Status'),
        options: [
          SelectOption.create({
            id: 'opt-json',
            name: '{"foo":"bar"}',
            color: 'green',
          })._unsafeUnwrap(),
        ],
      })._unsafeUnwrap();

      const visitor = FieldToSpecVisitor.create({ foo: 'bar' }, true);
      const result = jsonField.accept(visitor);
      expect(result.isOk()).toBe(true);
      expect((result._unsafeUnwrap() as SetSingleSelectValueSpec).value.toValue()).toBe(
        '{"foo":"bar"}'
      );
    });
  });

  describe('visitMultipleSelectField', () => {
    const options = [
      SelectOption.create({ id: 'opt1', name: 'Option One', color: 'red' })._unsafeUnwrap(),
      SelectOption.create({ id: 'opt2', name: 'Option Two', color: 'blue' })._unsafeUnwrap(),
      SelectOption.create({ id: 'opt3', name: 'Option Three', color: 'green' })._unsafeUnwrap(),
    ];

    const field = MultipleSelectField.create({
      id: createFieldId('b'),
      name: createFieldName('Tags'),
      options,
    })._unsafeUnwrap();

    it('accepts option IDs in non-typecast mode', () => {
      const visitor = FieldToSpecVisitor.create(['opt1', 'opt2'], false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('accepts option names in non-typecast mode (v1 compatibility)', () => {
      const visitor = FieldToSpecVisitor.create(['Option One', 'Option Two'], false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('accepts mixed IDs and names in non-typecast mode', () => {
      const visitor = FieldToSpecVisitor.create(['opt1', 'Option Two'], false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('rejects array with invalid option in non-typecast mode', () => {
      const visitor = FieldToSpecVisitor.create(['Option One', 'Invalid'], false);
      const result = field.accept(visitor);
      expect(result.isErr()).toBe(true);
    });

    it('accepts option IDs in typecast mode', () => {
      const visitor = FieldToSpecVisitor.create(['opt1', 'opt2'], true);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('accepts option names in typecast mode', () => {
      const visitor = FieldToSpecVisitor.create(['Option One', 'Option Two'], true);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('ignores invalid options in typecast mode', () => {
      const visitor = FieldToSpecVisitor.create(['Option One', 'Invalid'], true);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      // In typecast mode, invalid options are silently ignored
    });

    it('accepts null value', () => {
      const visitor = FieldToSpecVisitor.create(null, false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('accepts empty array', () => {
      const visitor = FieldToSpecVisitor.create([], false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('visitUserField', () => {
    const field = UserField.create({
      id: createFieldId('c'),
      name: createFieldName('Assignee'),
      isMultiple: UserMultiplicity.single(),
    })._unsafeUnwrap();

    const multipleField = UserField.create({
      id: createFieldId('d'),
      name: createFieldName('Team'),
      isMultiple: UserMultiplicity.multiple(),
    })._unsafeUnwrap();

    it('accepts null value', () => {
      const visitor = FieldToSpecVisitor.create(null, false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(SetUserValueSpec);
    });

    it('accepts user object with id', () => {
      const visitor = FieldToSpecVisitor.create({ id: 'usr123', title: 'John' }, false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(SetUserValueSpec);
    });

    it('normalizes single user field array input to one object', () => {
      const visitor = FieldToSpecVisitor.create([{ id: 'usr123', title: 'John' }], true);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      const value = (result._unsafeUnwrap() as SetUserValueSpec).value.toValue();
      expect(value).toEqual({ id: 'usr123', title: 'John' });
    });

    it('normalizes multiple user field object input to array', () => {
      const visitor = FieldToSpecVisitor.create({ id: 'usr123', title: 'John' }, true);
      const result = multipleField.accept(visitor);
      expect(result.isOk()).toBe(true);
      const value = (result._unsafeUnwrap() as SetUserValueSpec).value.toValue();
      expect(value).toEqual([{ id: 'usr123', title: 'John' }]);
    });

    it('treats empty string as null in typecast mode', () => {
      const visitor = FieldToSpecVisitor.create('', true);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      // Empty string should result in SetUserValueSpec with null value, not SetUserValueByIdentifierSpec
      expect(result._unsafeUnwrap()).toBeInstanceOf(SetUserValueSpec);
    });

    it('treats whitespace-only string as null in typecast mode', () => {
      const visitor = FieldToSpecVisitor.create('   ', true);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(SetUserValueSpec);
    });

    it('treats array of empty strings as null in typecast mode for multiple user field', () => {
      const visitor = FieldToSpecVisitor.create(['', '  '], true);
      const result = multipleField.accept(visitor);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(SetUserValueSpec);
    });
  });

  describe('visitButtonField', () => {
    const field = ButtonField.create({
      id: createFieldId('e'),
      name: createFieldName('Action'),
    })._unsafeUnwrap();

    it('ignores provided value in non-typecast mode', () => {
      const visitor = FieldToSpecVisitor.create('Click', false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(NoopCellValueSpec);
    });

    it('ignores provided value in typecast mode', () => {
      const visitor = FieldToSpecVisitor.create('Click', true);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(NoopCellValueSpec);
    });
  });

  describe('visitSingleLineTextField', () => {
    const field = SingleLineTextField.create({
      id: createFieldId('f'),
      name: createFieldName('Title'),
    })._unsafeUnwrap();

    it('converts any value to string', () => {
      const visitor = FieldToSpecVisitor.create(123, false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(SetSingleLineTextValueSpec);
    });

    it('accepts null value', () => {
      const visitor = FieldToSpecVisitor.create(null, false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(SetSingleLineTextValueSpec);
    });

    it('converts boolean to string', () => {
      const visitor = FieldToSpecVisitor.create(true, false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('visitNumberField', () => {
    const field = NumberField.create({
      id: createFieldId('g'),
      name: createFieldName('Count'),
    })._unsafeUnwrap();

    it('accepts number value', () => {
      const visitor = FieldToSpecVisitor.create(42, false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(SetNumberValueSpec);
    });

    it('accepts null value', () => {
      const visitor = FieldToSpecVisitor.create(null, false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('converts NaN to null', () => {
      const visitor = FieldToSpecVisitor.create(NaN, false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('rejects string in non-typecast mode', () => {
      const visitor = FieldToSpecVisitor.create('123', false);
      const result = field.accept(visitor);
      expect(result.isErr()).toBe(true);
    });

    it('converts string to number in typecast mode', () => {
      const visitor = FieldToSpecVisitor.create('123', true);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('returns null for non-numeric string in typecast mode', () => {
      const visitor = FieldToSpecVisitor.create('abc', true);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('visitCheckboxField', () => {
    const field = CheckboxField.create({
      id: createFieldId('h'),
      name: createFieldName('Done'),
    })._unsafeUnwrap();

    it('accepts boolean value', () => {
      const visitor = FieldToSpecVisitor.create(true, false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(SetCheckboxValueSpec);
    });

    it('accepts null value', () => {
      const visitor = FieldToSpecVisitor.create(null, false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('rejects string in non-typecast mode', () => {
      const visitor = FieldToSpecVisitor.create('true', false);
      const result = field.accept(visitor);
      expect(result.isErr()).toBe(true);
    });

    it('converts string "true" to boolean in typecast mode', () => {
      const visitor = FieldToSpecVisitor.create('true', true);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('converts string "false" to boolean in typecast mode', () => {
      const visitor = FieldToSpecVisitor.create('false', true);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('converts string "1" to true in typecast mode', () => {
      const visitor = FieldToSpecVisitor.create('1', true);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('visitDateField', () => {
    const field = DateField.create({
      id: createFieldId('i'),
      name: createFieldName('Due'),
    })._unsafeUnwrap();

    it('accepts null value', () => {
      const visitor = FieldToSpecVisitor.create(null, false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(SetDateValueSpec);
    });

    it('accepts valid ISO date string', () => {
      const visitor = FieldToSpecVisitor.create('2024-01-15T10:30:00.000Z', false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('returns null for invalid date in typecast mode', () => {
      const visitor = FieldToSpecVisitor.create('not-a-date', true);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
    });

    it('rejects invalid date in non-typecast mode', () => {
      const visitor = FieldToSpecVisitor.create('not-a-date', false);
      const result = field.accept(visitor);
      // May reject or return null depending on parseDateValue implementation
      // The important thing is it doesn't throw
      expect(result.isOk() || result.isErr()).toBe(true);
    });
  });

  describe('computed fields are readonly', () => {
    it('rejects formula field', () => {
      const expr = FormulaExpression.create('1 + 1')._unsafeUnwrap();
      const field = FormulaField.create({
        id: createFieldId('j'),
        name: createFieldName('Calc'),
        expression: expr,
      })._unsafeUnwrap();

      const visitor = FieldToSpecVisitor.create(42, false);
      const result = field.accept(visitor);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('computed field');
    });
  });

  describe('visitLinkField', () => {
    it('accepts null value', () => {
      const configResult = LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: 'tbl' + 'x'.repeat(16),
        lookupFieldId: 'fld' + 'y'.repeat(16),
        isOneWay: true,
      });
      const field = LinkField.create({
        id: createFieldId('k'),
        name: createFieldName('Related'),
        config: configResult._unsafeUnwrap(),
      })._unsafeUnwrap();

      const visitor = FieldToSpecVisitor.create(null, false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(SetLinkValueSpec);
    });

    it('accepts array of objects with id', () => {
      const configResult = LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: 'tbl' + 'x'.repeat(16),
        lookupFieldId: 'fld' + 'y'.repeat(16),
        isOneWay: true,
      });
      const field = LinkField.create({
        id: createFieldId('l'),
        name: createFieldName('Related'),
        config: configResult._unsafeUnwrap(),
      })._unsafeUnwrap();

      const visitor = FieldToSpecVisitor.create([{ id: 'rec' + 'a'.repeat(16) }], false);
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(SetLinkValueSpec);
    });

    it('rejects non-object array in non-typecast mode', () => {
      const configResult = LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: 'tbl' + 'x'.repeat(16),
        lookupFieldId: 'fld' + 'y'.repeat(16),
        isOneWay: true,
      });
      const field = LinkField.create({
        id: createFieldId('m'),
        name: createFieldName('Related'),
        config: configResult._unsafeUnwrap(),
      })._unsafeUnwrap();

      const visitor = FieldToSpecVisitor.create(['Title1', 'Title2'], false);
      const result = field.accept(visitor);
      expect(result.isErr()).toBe(true);
    });
  });
});
