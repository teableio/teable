import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { tableFieldInputSchema } from '../../schemas/field';
import { BaseId } from './BaseId';
import {
  optionalBaseIdsEqual,
  optionalForeignBaseIdSchema,
  parseOptionalForeignBaseId,
} from './optionalForeignBaseId';

describe('optionalForeignBaseIdSchema', () => {
  it.each([undefined, null, '', 'bsexxxxxxxxxxxxxxxx'])('accepts %j', (value) => {
    expect(optionalForeignBaseIdSchema.safeParse(value).success).toBe(true);
  });

  it('treats empty string and null as undefined', () => {
    expect(optionalForeignBaseIdSchema.parse('')).toBeUndefined();
    expect(optionalForeignBaseIdSchema.parse(null)).toBeUndefined();
    expect(optionalForeignBaseIdSchema.parse(undefined)).toBeUndefined();
  });

  it('keeps conditional field input baseId optional (T7064)', () => {
    const field: z.input<typeof tableFieldInputSchema> = {
      type: 'conditionalRollup',
      options: { expression: 'countall({values})' },
      config: {
        foreignTableId: 'tblxxxxxxxxxxxxxxxx',
        lookupFieldId: 'fldxxxxxxxxxxxxxxxx',
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldyyyyyyyyyyyyyyyy', operator: 'is', value: 'Active' }],
          },
        },
      },
    };

    expect(tableFieldInputSchema.safeParse(field).success).toBe(true);
  });
});

describe('parseOptionalForeignBaseId', () => {
  it('returns undefined for empty values', () => {
    expect(parseOptionalForeignBaseId(undefined)._unsafeUnwrap()).toBeUndefined();
    expect(parseOptionalForeignBaseId('')._unsafeUnwrap()).toBeUndefined();
    expect(parseOptionalForeignBaseId(null)._unsafeUnwrap()).toBeUndefined();
  });

  it('creates a BaseId for a valid id', () => {
    const id = 'bsexxxxxxxxxxxxxxxx';
    expect(parseOptionalForeignBaseId(id)._unsafeUnwrap()?.toString()).toBe(id);
  });

  it.each([42, false, {}])('rejects malformed value %j', (value) => {
    expect(parseOptionalForeignBaseId(value).isErr()).toBe(true);
  });
});

describe('optionalBaseIdsEqual', () => {
  const baseId = BaseId.create('bsexxxxxxxxxxxxxxxx')._unsafeUnwrap();

  it('treats missing ids as equal', () => {
    expect(optionalBaseIdsEqual(undefined, undefined)).toBe(true);
    expect(optionalBaseIdsEqual(baseId, undefined)).toBe(false);
    expect(optionalBaseIdsEqual(undefined, baseId)).toBe(false);
  });

  it('compares defined ids', () => {
    expect(optionalBaseIdsEqual(baseId, baseId)).toBe(true);
    expect(
      optionalBaseIdsEqual(baseId, BaseId.create('bseyyyyyyyyyyyyyyyy')._unsafeUnwrap())
    ).toBe(false);
  });
});
