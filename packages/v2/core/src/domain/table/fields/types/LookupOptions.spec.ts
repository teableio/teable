import { describe, expect, it } from 'vitest';

import { TableId } from '../../TableId';
import { FieldId } from '../FieldId';
import { LookupOptions } from './LookupOptions';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`);

describe('LookupOptions', () => {
  describe('creation', () => {
    it('creates lookup options with valid input', () => {
      const linkFieldIdResult = createFieldId('a');
      const foreignTableIdResult = createTableId('b');
      const lookupFieldIdResult = createFieldId('c');

      const result = LookupOptions.create({
        linkFieldId: linkFieldIdResult._unsafeUnwrap().toString(),
        foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
        lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
      });

      expect(result.isOk()).toBe(true);
      const options = result._unsafeUnwrap();

      expect(options.linkFieldId().equals(linkFieldIdResult._unsafeUnwrap())).toBe(true);
      expect(options.foreignTableId().equals(foreignTableIdResult._unsafeUnwrap())).toBe(true);
      expect(options.lookupFieldId().equals(lookupFieldIdResult._unsafeUnwrap())).toBe(true);
    });

    it('rejects invalid input', () => {
      const result = LookupOptions.create({
        // Missing required fields
      });

      expect(result.isErr()).toBe(true);
    });

    it('rejects input with invalid field id format', () => {
      const result = LookupOptions.create({
        linkFieldId: 'invalid',
        foreignTableId: 'tbl' + 'a'.repeat(16),
        lookupFieldId: 'fld' + 'b'.repeat(16),
      });

      expect(result.isErr()).toBe(true);
    });

    it('rejects input with invalid table id format', () => {
      const result = LookupOptions.create({
        linkFieldId: 'fld' + 'a'.repeat(16),
        foreignTableId: 'invalid',
        lookupFieldId: 'fld' + 'b'.repeat(16),
      });

      expect(result.isErr()).toBe(true);
    });

    it('accepts lookup filter options', () => {
      const linkFieldId = createFieldId('m')._unsafeUnwrap().toString();
      const foreignTableId = createTableId('n')._unsafeUnwrap().toString();
      const lookupFieldId = createFieldId('o')._unsafeUnwrap().toString();
      const statusFieldId = createFieldId('p')._unsafeUnwrap().toString();

      const filter = {
        conjunction: 'and' as const,
        filterSet: [
          {
            fieldId: statusFieldId,
            operator: 'is',
            value: 'active',
          },
        ],
      };

      const result = LookupOptions.create({
        linkFieldId,
        foreignTableId,
        lookupFieldId,
        filter,
        sort: { fieldId: statusFieldId, order: 'asc' },
        limit: 1,
      });

      expect(result.isOk()).toBe(true);
      const dto = result._unsafeUnwrap().toDto();
      expect(dto.filter).toEqual(filter);
      expect(dto.sort).toEqual({ fieldId: statusFieldId, order: 'asc' });
      expect(dto.limit).toBe(1);
    });
  });

  describe('toDto', () => {
    it('converts to DTO format', () => {
      const linkFieldId = 'fld' + 'a'.repeat(16);
      const foreignTableId = 'tbl' + 'b'.repeat(16);
      const lookupFieldId = 'fld' + 'c'.repeat(16);

      const result = LookupOptions.create({
        linkFieldId,
        foreignTableId,
        lookupFieldId,
      });

      const dto = result._unsafeUnwrap().toDto();

      expect(dto.linkFieldId).toBe(linkFieldId);
      expect(dto.foreignTableId).toBe(foreignTableId);
      expect(dto.lookupFieldId).toBe(lookupFieldId);
    });
  });

  describe('accessors', () => {
    it('returns linkFieldId as FieldId value object', () => {
      const linkFieldId = 'fld' + 'd'.repeat(16);
      const foreignTableId = 'tbl' + 'e'.repeat(16);
      const lookupFieldId = 'fld' + 'f'.repeat(16);

      const result = LookupOptions.create({
        linkFieldId,
        foreignTableId,
        lookupFieldId,
      });

      const options = result._unsafeUnwrap();
      expect(options.linkFieldId().toString()).toBe(linkFieldId);
    });

    it('returns foreignTableId as TableId value object', () => {
      const linkFieldId = 'fld' + 'g'.repeat(16);
      const foreignTableId = 'tbl' + 'h'.repeat(16);
      const lookupFieldId = 'fld' + 'i'.repeat(16);

      const result = LookupOptions.create({
        linkFieldId,
        foreignTableId,
        lookupFieldId,
      });

      const options = result._unsafeUnwrap();
      expect(options.foreignTableId().toString()).toBe(foreignTableId);
    });

    it('returns lookupFieldId as FieldId value object', () => {
      const linkFieldId = 'fld' + 'j'.repeat(16);
      const foreignTableId = 'tbl' + 'k'.repeat(16);
      const lookupFieldId = 'fld' + 'l'.repeat(16);

      const result = LookupOptions.create({
        linkFieldId,
        foreignTableId,
        lookupFieldId,
      });

      const options = result._unsafeUnwrap();
      expect(options.lookupFieldId().toString()).toBe(lookupFieldId);
    });
  });
});
