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
});
