import { describe, expect, it } from 'vitest';

import {
  describeError,
  extractConditionFieldIds,
  parseConditionalFieldOptions,
  parseJson,
  parseLinkOptions,
  parseLookupOptions,
  readOptionalString,
  readString,
} from './parsers';

describe('parsers', () => {
  describe('parseJson', () => {
    it('parses valid JSON', () => {
      const result = parseJson('{"key": "value"}', 'test');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({ key: 'value' });
    });

    it('returns error for invalid JSON', () => {
      const result = parseJson('invalid json', 'test');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Invalid JSON');
    });
  });

  describe('readString', () => {
    it('reads existing string', () => {
      const result = readString({ key: 'value' }, 'key');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe('value');
    });

    it('returns error for missing key', () => {
      const result = readString({}, 'key');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Missing string');
    });

    it('returns error for empty string', () => {
      const result = readString({ key: '' }, 'key');
      expect(result.isErr()).toBe(true);
    });

    it('returns error for non-string value', () => {
      const result = readString({ key: 123 }, 'key');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('readOptionalString', () => {
    it('reads existing string', () => {
      const result = readOptionalString({ key: 'value' }, 'key');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe('value');
    });

    it('returns undefined for missing key', () => {
      const result = readOptionalString({}, 'key');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeUndefined();
    });

    it('returns undefined for null value', () => {
      const result = readOptionalString({ key: null }, 'key');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeUndefined();
    });

    it('returns error for empty string', () => {
      const result = readOptionalString({ key: '' }, 'key');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('extractConditionFieldIds', () => {
    it('extracts field IDs from simple filter', () => {
      const filter = {
        conjunction: 'and',
        filterSet: [
          { fieldId: 'fld1', operator: 'is', value: 'test' },
          { fieldId: 'fld2', operator: 'isNot', value: 'foo' },
        ],
      };
      const result = extractConditionFieldIds(filter);
      expect(result).toEqual(['fld1', 'fld2']);
    });

    it('extracts field IDs from nested filter', () => {
      const filter = {
        conjunction: 'and',
        filterSet: [
          { fieldId: 'fld1', operator: 'is', value: 'test' },
          {
            conjunction: 'or',
            filterSet: [
              { fieldId: 'fld2', operator: 'is', value: 'a' },
              { fieldId: 'fld3', operator: 'is', value: 'b' },
            ],
          },
        ],
      };
      const result = extractConditionFieldIds(filter);
      expect(result).toEqual(['fld1', 'fld2', 'fld3']);
    });

    it('returns empty array for null filter', () => {
      expect(extractConditionFieldIds(null)).toEqual([]);
    });

    it('returns empty array for undefined filter', () => {
      expect(extractConditionFieldIds(undefined)).toEqual([]);
    });

    it('returns empty array for empty filter', () => {
      expect(extractConditionFieldIds({})).toEqual([]);
    });

    it('skips invalid items in filterSet', () => {
      const filter = {
        filterSet: [
          { fieldId: 'fld1', operator: 'is', value: 'test' },
          null,
          { invalid: 'item' },
          { fieldId: '', operator: 'is', value: 'empty' }, // empty fieldId
        ],
      };
      const result = extractConditionFieldIds(filter);
      expect(result).toEqual(['fld1']);
    });
  });

  describe('parseLinkOptions', () => {
    it('parses valid link options', () => {
      const raw = JSON.stringify({
        foreignTableId: 'tbl1',
        lookupFieldId: 'fld1',
        symmetricFieldId: 'fld2',
        relationship: 'manyOne',
      });
      const result = parseLinkOptions(raw);
      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value).toEqual({
        foreignTableId: 'tbl1',
        lookupFieldId: 'fld1',
        symmetricFieldId: 'fld2',
        relationship: 'manyOne',
      });
    });

    it('returns null for null input', () => {
      const result = parseLinkOptions(null);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('handles minimal required fields', () => {
      const raw = JSON.stringify({
        foreignTableId: 'tbl1',
        lookupFieldId: 'fld1',
      });
      const result = parseLinkOptions(raw);
      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value).toEqual({
        foreignTableId: 'tbl1',
        lookupFieldId: 'fld1',
      });
    });

    it('returns error for missing foreignTableId', () => {
      const raw = JSON.stringify({ lookupFieldId: 'fld1' });
      const result = parseLinkOptions(raw);
      expect(result.isErr()).toBe(true);
    });
  });

  describe('parseLookupOptions', () => {
    it('parses valid lookup options', () => {
      const raw = JSON.stringify({
        linkFieldId: 'fldLink',
        foreignTableId: 'tbl1',
        lookupFieldId: 'fld1',
      });
      const result = parseLookupOptions(raw);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        linkFieldId: 'fldLink',
        foreignTableId: 'tbl1',
        lookupFieldId: 'fld1',
      });
    });

    it('returns null for null input', () => {
      const result = parseLookupOptions(null);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('returns error for missing required fields', () => {
      const raw = JSON.stringify({ linkFieldId: 'fldLink' });
      const result = parseLookupOptions(raw);
      expect(result.isErr()).toBe(true);
    });
  });

  describe('parseConditionalFieldOptions', () => {
    it('parses v1 format (filter at top level)', () => {
      const raw = JSON.stringify({
        foreignTableId: 'tbl1',
        lookupFieldId: 'fld1',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fld2', operator: 'is', value: 'test' }],
        },
      });
      const result = parseConditionalFieldOptions(raw);
      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value).toEqual({
        foreignTableId: 'tbl1',
        lookupFieldId: 'fld1',
        conditionFieldIds: ['fld2'],
        filterDto: expect.any(Object),
      });
    });

    it('parses v2 format (filter in condition)', () => {
      const raw = JSON.stringify({
        foreignTableId: 'tbl1',
        lookupFieldId: 'fld1',
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fld3', operator: 'is', value: 'test' }],
          },
        },
      });
      const result = parseConditionalFieldOptions(raw);
      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value?.conditionFieldIds).toEqual(['fld3']);
    });

    it('returns null for missing required fields', () => {
      const raw = JSON.stringify({ foreignTableId: 'tbl1' }); // missing lookupFieldId
      const result = parseConditionalFieldOptions(raw);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('returns null for null input', () => {
      const result = parseConditionalFieldOptions(null);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });
  });

  describe('describeError', () => {
    it('describes Error object', () => {
      const error = new Error('test error');
      expect(describeError(error)).toBe('Error: test error');
    });

    it('describes string error', () => {
      expect(describeError('string error')).toBe('string error');
    });

    it('describes object error', () => {
      const error = { code: 'ERR', message: 'test' };
      expect(describeError(error)).toBe('{"code":"ERR","message":"test"}');
    });

    it('handles null', () => {
      expect(describeError(null)).toBe('null');
    });

    it('handles undefined', () => {
      expect(describeError(undefined)).toBe('undefined');
    });
  });
});
