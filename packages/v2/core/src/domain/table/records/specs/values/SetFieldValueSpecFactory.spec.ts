import { describe, expect, it } from 'vitest';

import { FieldId } from '../../../fields/FieldId';
import { FieldName } from '../../../fields/FieldName';
import { ButtonField } from '../../../fields/types/ButtonField';
import { FieldNotNull } from '../../../fields/types/FieldNotNull';
import { LinkField } from '../../../fields/types/LinkField';
import { LinkFieldConfig } from '../../../fields/types/LinkFieldConfig';
import { UserField } from '../../../fields/types/UserField';
import { UserMultiplicity } from '../../../fields/types/UserMultiplicity';
import { ClearFieldValueSpec } from './ClearFieldValueSpec';
import { SetLinkValueSpec } from './SetLinkValueSpec';
import { SetButtonValueSpec } from './SetButtonValueSpec';
import { SetFieldValueSpecFactory } from './SetFieldValueSpecFactory';
import { SetUserValueSpec } from './SetUserValueSpec';

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

  describe('user field', () => {
    const field = UserField.create({
      id: createFieldId('u'),
      name: createFieldName('Assignee'),
      isMultiple: UserMultiplicity.single(),
    })._unsafeUnwrap();

    it('accepts a bare id reference in strict mode', () => {
      const spec = SetFieldValueSpecFactory.create(field, { id: 'usr-1' })._unsafeUnwrap();
      expect(spec).toBeInstanceOf(SetUserValueSpec);
      expect((spec as SetUserValueSpec).value.toValue()).toEqual({ id: 'usr-1' });
    });

    it('marks schema-validated (strict) user writes as collaborator scoped', () => {
      const spec = SetFieldValueSpecFactory.create(field, { id: 'usr-1' })._unsafeUnwrap();
      expect((spec as SetUserValueSpec).requireCollaborator).toBe(true);
    });

    it('keeps pre-validated user writes platform scoped', () => {
      const spec = SetFieldValueSpecFactory.createFromValidated(field, {
        id: 'usr-1',
        title: 'Alice',
      })._unsafeUnwrap();
      expect((spec as SetUserValueSpec).requireCollaborator).toBe(false);
    });
  });

  describe.each([
    { relationship: 'manyOne' as const, seed: 'l', lookupSeed: 'm' },
    { relationship: 'manyMany' as const, seed: 'n', lookupSeed: 'o' },
  ])('link field ($relationship)', ({ relationship, seed, lookupSeed }) => {
    const field = LinkField.create({
      id: createFieldId(seed),
      name: createFieldName('Customer'),
      config: LinkFieldConfig.create({
        relationship,
        foreignTableId: `tbl${'t'.repeat(16)}`,
        lookupFieldId: `fld${lookupSeed.repeat(16)}`,
      })._unsafeUnwrap(),
    })._unsafeUnwrap();
    const item = { id: `rec${'r'.repeat(16)}`, title: 'Acme' };

    // manyOne clears through the clear spec; manyMany keeps the link spec so the
    // junction rows are removed, with the same null cell value.
    const expectCleared = (spec: unknown) => {
      if (spec instanceof ClearFieldValueSpec) return;
      expect(spec).toBeInstanceOf(SetLinkValueSpec);
      expect((spec as SetLinkValueSpec).value.toValue()).toBeNull();
    };

    it('clears an empty id list', () => {
      expectCleared(SetFieldValueSpecFactory.create(field, [])._unsafeUnwrap());
    });

    it('clears idempotently when the cell is already empty', () => {
      expectCleared(SetFieldValueSpecFactory.create(field, [])._unsafeUnwrap());
      expectCleared(SetFieldValueSpecFactory.create(field, [])._unsafeUnwrap());
    });

    it('clears null', () => {
      expect(SetFieldValueSpecFactory.create(field, null)._unsafeUnwrap()).toBeInstanceOf(
        ClearFieldValueSpec
      );
    });

    it('still accepts a non-empty id list', () => {
      const spec = SetFieldValueSpecFactory.create(field, [item])._unsafeUnwrap();
      expect(spec).toBeInstanceOf(SetLinkValueSpec);
    });

    it('rejects a malformed non-empty list', () => {
      expect(SetFieldValueSpecFactory.create(field, [{ title: 'no id' }]).isErr()).toBe(true);
    });
  });

  describe.each([
    { relationship: 'manyOne' as const, seed: 'p', lookupSeed: 'q' },
    { relationship: 'manyMany' as const, seed: 'r', lookupSeed: 's' },
  ])('not-null link field ($relationship)', ({ relationship, seed, lookupSeed }) => {
    const field = LinkField.create({
      id: createFieldId(seed),
      name: createFieldName('Required customer'),
      config: LinkFieldConfig.create({
        relationship,
        foreignTableId: `tbl${'u'.repeat(16)}`,
        lookupFieldId: `fld${lookupSeed.repeat(16)}`,
      })._unsafeUnwrap(),
    })._unsafeUnwrap();
    field.setNotNull(FieldNotNull.create(true)._unsafeUnwrap())._unsafeUnwrap();

    it.each([
      ['null', null],
      ['an empty list', []],
    ])('rejects %s like a null clear', (_label, value) => {
      const result = SetFieldValueSpecFactory.create(field, value);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('validation.field.not_null');
      }
    });

    it('still accepts a real target', () => {
      const spec = SetFieldValueSpecFactory.create(field, [
        { id: `rec${'v'.repeat(16)}`, title: 'Acme' },
      ])._unsafeUnwrap();
      expect(spec).toBeInstanceOf(SetLinkValueSpec);
    });
  });
});
