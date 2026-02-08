import { describe, expect, it } from 'vitest';

import { FieldId } from '../../../fields/FieldId';
import { FieldName } from '../../../fields/FieldName';
import { ButtonField } from '../../../fields/types/ButtonField';
import { NoopCellValueSpec } from './NoopCellValueSpec';
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

    it('returns NoopCellValueSpec when creating with raw value', () => {
      const result = SetFieldValueSpecFactory.create(field, 'Click');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(NoopCellValueSpec);
    });

    it('returns NoopCellValueSpec when creating from validated value', () => {
      const result = SetFieldValueSpecFactory.createFromValidated(field, 'Click');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(NoopCellValueSpec);
    });
  });
});
