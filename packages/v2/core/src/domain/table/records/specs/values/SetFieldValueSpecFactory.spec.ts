import { describe, expect, it } from 'vitest';

import { FieldId } from '../../../fields/FieldId';
import { FieldName } from '../../../fields/FieldName';
import { ButtonField } from '../../../fields/types/ButtonField';
import { ClearFieldValueSpec } from './ClearFieldValueSpec';
import { SetButtonValueSpec } from './SetButtonValueSpec';
import { SetFieldValueSpecFactory } from './SetFieldValueSpecFactory';

const createFieldId = (seed: string) =>
  FieldId.create(`fld${seed.padEnd(16, '0').slice(0, 16)}`)._unsafeUnwrap();
const createFieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();

describe('SetFieldValueSpecFactory', () => {
  describe('button field', () => {
    const field = ButtonField.create({
      id: createFieldId('b'),
      name: createFieldName('Action'),
    })._unsafeUnwrap();

    it.each([0, 3])('persists a raw count of %s', (count) => {
      const spec = SetFieldValueSpecFactory.create(field, { count })._unsafeUnwrap();
      expect(spec).toBeInstanceOf(SetButtonValueSpec);
      expect((spec as SetButtonValueSpec).value.toValue()).toEqual({ count });
    });

    it('persists a validated count', () => {
      const spec = SetFieldValueSpecFactory.createFromValidated(field, {
        count: 3,
      })._unsafeUnwrap();
      expect(spec).toBeInstanceOf(SetButtonValueSpec);
      expect((spec as SetButtonValueSpec).value.toValue()).toEqual({ count: 3 });
    });

    it.each(['Click', {}, { count: '3' }, { count: 1.5 }])('rejects invalid input %j', (value) => {
      expect(SetFieldValueSpecFactory.create(field, value).isErr()).toBe(true);
    });

    it('clears null values', () => {
      expect(SetFieldValueSpecFactory.create(field, null)._unsafeUnwrap()).toBeInstanceOf(
        ClearFieldValueSpec
      );
    });
  });
});
