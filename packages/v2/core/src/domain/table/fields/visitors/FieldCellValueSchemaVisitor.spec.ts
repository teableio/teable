import { describe, expect, it } from 'vitest';

import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { DateField } from '../types/DateField';
import { LinkField } from '../types/LinkField';
import { LinkFieldConfig } from '../types/LinkFieldConfig';
import { MultipleSelectField } from '../types/MultipleSelectField';
import { SelectOption } from '../types/SelectOption';
import { SingleSelectField } from '../types/SingleSelectField';
import { DateField } from '../types/DateField';
import { LinkField } from '../types/LinkField';
import { LinkFieldConfig } from '../types/LinkFieldConfig';
import { FieldCellValueSchemaVisitor } from './FieldCellValueSchemaVisitor';

const createFieldId = (seed: string) =>
  FieldId.create(`fld${seed.padEnd(16, '0').slice(0, 16)}`)._unsafeUnwrap();
const createFieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();

describe('FieldCellValueSchemaVisitor', () => {
  const visitor = FieldCellValueSchemaVisitor.create();

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

    it('generates schema that accepts option IDs', () => {
      const schemaResult = field.accept(visitor);
      expect(schemaResult.isOk()).toBe(true);
      const schema = schemaResult._unsafeUnwrap();

      const parseResult = schema.safeParse('opt1');
      expect(parseResult.success).toBe(true);
    });

    it('generates schema that accepts option names (v1 compatibility)', () => {
      const schemaResult = field.accept(visitor);
      expect(schemaResult.isOk()).toBe(true);
      const schema = schemaResult._unsafeUnwrap();

      const parseResult = schema.safeParse('Option One');
      expect(parseResult.success).toBe(true);
    });

    it('generates schema that rejects invalid options', () => {
      const schemaResult = field.accept(visitor);
      expect(schemaResult.isOk()).toBe(true);
      const schema = schemaResult._unsafeUnwrap();

      const parseResult = schema.safeParse('Invalid');
      expect(parseResult.success).toBe(false);
    });

    it('generates schema that accepts null', () => {
      const schemaResult = field.accept(visitor);
      expect(schemaResult.isOk()).toBe(true);
      const schema = schemaResult._unsafeUnwrap();

      const parseResult = schema.safeParse(null);
      expect(parseResult.success).toBe(true);
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

    it('generates schema that accepts array of option IDs', () => {
      const schemaResult = field.accept(visitor);
      expect(schemaResult.isOk()).toBe(true);
      const schema = schemaResult._unsafeUnwrap();

      const parseResult = schema.safeParse(['opt1', 'opt2']);
      expect(parseResult.success).toBe(true);
    });

    it('generates schema that accepts array of option names (v1 compatibility)', () => {
      const schemaResult = field.accept(visitor);
      expect(schemaResult.isOk()).toBe(true);
      const schema = schemaResult._unsafeUnwrap();

      const parseResult = schema.safeParse(['Option One', 'Option Two']);
      expect(parseResult.success).toBe(true);
    });

    it('generates schema that accepts mixed IDs and names', () => {
      const schemaResult = field.accept(visitor);
      expect(schemaResult.isOk()).toBe(true);
      const schema = schemaResult._unsafeUnwrap();

      const parseResult = schema.safeParse(['opt1', 'Option Two']);
      expect(parseResult.success).toBe(true);
    });

    it('generates schema that rejects array with invalid options', () => {
      const schemaResult = field.accept(visitor);
      expect(schemaResult.isOk()).toBe(true);
      const schema = schemaResult._unsafeUnwrap();

      const parseResult = schema.safeParse(['opt1', 'Invalid']);
      expect(parseResult.success).toBe(false);
    });

    it('generates schema that accepts null', () => {
      const schemaResult = field.accept(visitor);
      expect(schemaResult.isOk()).toBe(true);
      const schema = schemaResult._unsafeUnwrap();

      const parseResult = schema.safeParse(null);
      expect(parseResult.success).toBe(true);
    });

    it('normalizes empty array to null', () => {
      const schemaResult = field.accept(visitor);
      expect(schemaResult.isOk()).toBe(true);
      const schema = schemaResult._unsafeUnwrap();

      const parseResult = schema.safeParse([]);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) return;
      expect(parseResult.data).toBeNull();
    });
  });

  describe('handles duplicate ID and name', () => {
    // Edge case: when option ID equals option name
    const options = [
      SelectOption.create({ id: 'alpha', name: 'alpha', color: 'red' })._unsafeUnwrap(),
      SelectOption.create({ id: 'beta', name: 'beta', color: 'blue' })._unsafeUnwrap(),
    ];

    const field = SingleSelectField.create({
      id: createFieldId('c'),
      name: createFieldName('Status'),
      options,
    })._unsafeUnwrap();

    it('generates schema without duplicate values', () => {
      const schemaResult = field.accept(visitor);
      expect(schemaResult.isOk()).toBe(true);
      const schema = schemaResult._unsafeUnwrap();

      const parseResult = schema.safeParse('alpha');
      expect(parseResult.success).toBe(true);
    });
  });

  describe('visitDateField', () => {
    const optionalDateField = DateField.create({
      id: createFieldId('d'),
      name: createFieldName('Due Date'),
    })._unsafeUnwrap();

    it('accepts Date instances and normalizes to ISO string', () => {
      const schemaResult = optionalDateField.accept(visitor);
      expect(schemaResult.isOk()).toBe(true);
      const schema = schemaResult._unsafeUnwrap();

      const input = new Date('2026-02-05T16:17:50.000Z');
      const parseResult = schema.safeParse(input);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) return;
      expect(parseResult.data).toBe(input.toISOString());
    });

    it('rejects invalid date string', () => {
      const schemaResult = optionalDateField.accept(visitor);
      expect(schemaResult.isOk()).toBe(true);
      const schema = schemaResult._unsafeUnwrap();

      const parseResult = schema.safeParse('not a date');
      expect(parseResult.success).toBe(false);
    });
  });

  describe('visitLinkField', () => {
    const validLink = { id: 'rec123', title: 'Linked Record' };
    const secondLink = { id: 'rec456', title: 'Second' };

    const createLinkField = (relationship: 'manyOne' | 'manyMany') =>
      LinkField.create({
        id: createFieldId(relationship === 'manyOne' ? 'linksingle' : 'linkmulti'),
        name: createFieldName(relationship === 'manyOne' ? 'Single Link' : 'Multi Link'),
        config: LinkFieldConfig.create({
          relationship,
          foreignTableId: `tbl${'f'.repeat(16)}`,
          lookupFieldId: `fld${'l'.repeat(16)}`,
          isOneWay: true,
        })._unsafeUnwrap(),
      })._unsafeUnwrap();

    it('accepts object and array for single-value link fields', () => {
      const schema = createLinkField('manyOne').accept(visitor)._unsafeUnwrap();

      expect(schema.safeParse(validLink).success).toBe(true);
      expect(schema.safeParse(validLink).data).toEqual(validLink);
      expect(schema.safeParse([validLink, secondLink]).success).toBe(true);
      expect(schema.safeParse([validLink, secondLink]).data).toEqual(validLink);
      expect(schema.safeParse([]).success).toBe(false);
      expect(schema.safeParse(null).success).toBe(true);
    });

    it('accepts array and object for multi-value link fields', () => {
      const schema = createLinkField('manyMany').accept(visitor)._unsafeUnwrap();

      expect(schema.safeParse([validLink]).success).toBe(true);
      expect(schema.safeParse([validLink]).data).toEqual([validLink]);
      expect(schema.safeParse(validLink).success).toBe(true);
      expect(schema.safeParse(validLink).data).toEqual([validLink]);
      expect(schema.safeParse([validLink, { ...validLink }]).success).toBe(false);
      expect(schema.safeParse(null).success).toBe(true);
    });

    it('accepts and strips null titles for single-value legacy links', () => {
      const schema = createLinkField('manyOne').accept(visitor)._unsafeUnwrap();

      expect(schema.safeParse({ id: 'rec123' }).data).toEqual({ id: 'rec123' });
      expect(schema.safeParse({ id: 'rec123', title: undefined }).data).toEqual({ id: 'rec123' });
      expect(schema.safeParse({ id: 'rec123', title: null }).data).toEqual({ id: 'rec123' });
    });

    it('accepts and strips null titles for multi-value legacy links', () => {
      const schema = createLinkField('manyMany').accept(visitor)._unsafeUnwrap();

      expect(
        schema.safeParse([
          { id: 'rec123', title: null },
          { id: 'rec456', title: 'Named' },
        ]).data
      ).toEqual([{ id: 'rec123' }, { id: 'rec456', title: 'Named' }]);
    });
  });
});
