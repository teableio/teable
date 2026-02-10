import { describe, expect, it } from 'vitest';

import { NoopCellValueSpec } from '../../records/specs/values/NoopCellValueSpec';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { ButtonField } from '../types/ButtonField';
import { SetFieldValueSpecFactoryVisitor } from './SetFieldValueSpecFactoryVisitor';

const createFieldId = (seed: string) =>
  FieldId.create(`fld${seed.padEnd(16, '0').slice(0, 16)}`)._unsafeUnwrap();
const createFieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();

describe('SetFieldValueSpecFactoryVisitor', () => {
  describe('visitButtonField', () => {
    const field = ButtonField.create({
      id: createFieldId('a'),
      name: createFieldName('Action'),
    })._unsafeUnwrap();

    it('returns NoopCellValueSpec for button fields', () => {
      const visitor = new SetFieldValueSpecFactoryVisitor('Click');
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(NoopCellValueSpec);
    });
  });
});
