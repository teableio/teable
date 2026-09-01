import { describe, expect, it } from 'vitest';

import { NoopCellValueSpec } from '../../records/specs/values/NoopCellValueSpec';
import type { SetAttachmentValueSpec } from '../../records/specs/values/SetAttachmentValueSpec';
import type { SetCheckboxValueSpec } from '../../records/specs/values/SetCheckboxValueSpec';
import type { SetLinkValueSpec } from '../../records/specs/values/SetLinkValueSpec';
import type { SetLongTextValueSpec } from '../../records/specs/values/SetLongTextValueSpec';
import type { SetMultipleSelectValueSpec } from '../../records/specs/values/SetMultipleSelectValueSpec';
import type { SetSingleLineTextValueSpec } from '../../records/specs/values/SetSingleLineTextValueSpec';
import type { SetUserValueSpec } from '../../records/specs/values/SetUserValueSpec';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { AttachmentField } from '../types/AttachmentField';
import { ButtonField } from '../types/ButtonField';
import { CheckboxField } from '../types/CheckboxField';
import { LinkField } from '../types/LinkField';
import { LinkFieldConfig } from '../types/LinkFieldConfig';
import { LongTextField } from '../types/LongTextField';
import { MultipleSelectField } from '../types/MultipleSelectField';
import { SelectOption } from '../types/SelectOption';
import { SingleLineTextField } from '../types/SingleLineTextField';
import { UserField } from '../types/UserField';
import { UserMultiplicity } from '../types/UserMultiplicity';
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

  // v1 stores "empty" inputs as null: "" (text), false (checkbox) and []
  // (multi-value fields). v2 must produce the same stored value (T6520).
  describe('empty value normalization (v1 parity)', () => {
    it('normalizes "" to null for singleLineText', () => {
      const field = SingleLineTextField.create({
        id: createFieldId('t'),
        name: createFieldName('Title'),
      })._unsafeUnwrap();
      const spec = field
        .accept(new SetFieldValueSpecFactoryVisitor(''))
        ._unsafeUnwrap() as SetSingleLineTextValueSpec;
      expect(spec.value.isNull()).toBe(true);
    });

    it('keeps non-empty text as-is for singleLineText', () => {
      const field = SingleLineTextField.create({
        id: createFieldId('t'),
        name: createFieldName('Title'),
      })._unsafeUnwrap();
      const spec = field
        .accept(new SetFieldValueSpecFactoryVisitor('hello'))
        ._unsafeUnwrap() as SetSingleLineTextValueSpec;
      expect(spec.value.toValue()).toBe('hello');
    });

    it('normalizes "" to null for longText', () => {
      const field = LongTextField.create({
        id: createFieldId('n'),
        name: createFieldName('Notes'),
      })._unsafeUnwrap();
      const spec = field
        .accept(new SetFieldValueSpecFactoryVisitor(''))
        ._unsafeUnwrap() as SetLongTextValueSpec;
      expect(spec.value.isNull()).toBe(true);
    });

    it('normalizes false to null for checkbox', () => {
      const field = CheckboxField.create({
        id: createFieldId('c'),
        name: createFieldName('Done'),
      })._unsafeUnwrap();
      const spec = field
        .accept(new SetFieldValueSpecFactoryVisitor(false))
        ._unsafeUnwrap() as SetCheckboxValueSpec;
      expect(spec.value.isNull()).toBe(true);
    });

    it('keeps true as-is for checkbox', () => {
      const field = CheckboxField.create({
        id: createFieldId('c'),
        name: createFieldName('Done'),
      })._unsafeUnwrap();
      const spec = field
        .accept(new SetFieldValueSpecFactoryVisitor(true))
        ._unsafeUnwrap() as SetCheckboxValueSpec;
      expect(spec.value.toValue()).toBe(true);
    });

    it('normalizes [] to null for multipleSelect', () => {
      const field = MultipleSelectField.create({
        id: createFieldId('m'),
        name: createFieldName('Tags'),
        options: [SelectOption.create({ id: 'opt1', name: 'One', color: 'red' })._unsafeUnwrap()],
      })._unsafeUnwrap();
      const spec = field
        .accept(new SetFieldValueSpecFactoryVisitor([]))
        ._unsafeUnwrap() as SetMultipleSelectValueSpec;
      expect(spec.value.isNull()).toBe(true);
    });

    it('normalizes [] to null for attachment', () => {
      const field = AttachmentField.create({
        id: createFieldId('f'),
        name: createFieldName('Files'),
      })._unsafeUnwrap();
      const spec = field
        .accept(new SetFieldValueSpecFactoryVisitor([]))
        ._unsafeUnwrap() as SetAttachmentValueSpec;
      expect(spec.value.isNull()).toBe(true);
    });

    it('normalizes [] to null for multi-value user', () => {
      const field = UserField.create({
        id: createFieldId('u'),
        name: createFieldName('Team'),
        isMultiple: UserMultiplicity.multiple(),
      })._unsafeUnwrap();
      const spec = field
        .accept(new SetFieldValueSpecFactoryVisitor([]))
        ._unsafeUnwrap() as SetUserValueSpec;
      expect(spec.value.isNull()).toBe(true);
    });

    it('normalizes [] to null for link', () => {
      const config = LinkFieldConfig.create({
        relationship: 'manyMany',
        foreignTableId: 'tbl' + 'x'.repeat(16),
        lookupFieldId: 'fld' + 'y'.repeat(16),
        isOneWay: true,
      })._unsafeUnwrap();
      const field = LinkField.create({
        id: createFieldId('l'),
        name: createFieldName('Related'),
        config,
      })._unsafeUnwrap();
      const spec = field
        .accept(new SetFieldValueSpecFactoryVisitor([]))
        ._unsafeUnwrap() as SetLinkValueSpec;
      expect(spec.value.isNull()).toBe(true);
    });
  });
});
