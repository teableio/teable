import type { IFieldVo } from '@teable/core';
import { FieldType } from '@teable/core';
import { describe, expect, it } from 'vitest';

import { createFieldInstanceByVo } from './factory';

const baseField = {
  id: 'fldFactorySpec00001',
  name: 'Factory Field',
  dbFieldName: 'factory_field',
  unique: false,
  options: {},
} as const;

describe('createFieldInstanceByVo', () => {
  it('normalizes v2 conditionalLookup using innerType and innerOptions', () => {
    const field = {
      ...baseField,
      type: 'conditionalLookup',
      isLookup: true,
      isConditionalLookup: true,
      options: {
        innerType: FieldType.Number,
        innerOptions: {
          formatting: { type: 'decimal', precision: 1 },
        },
      },
    } as unknown as IFieldVo;

    const instance = createFieldInstanceByVo(field);

    expect(instance.type).toBe(FieldType.Number);
    expect(instance.isLookup).toBe(true);
    expect(instance.isConditionalLookup).toBe(true);
    expect(instance.options).toEqual({
      formatting: { type: 'decimal', precision: 1 },
    });
  });

  it('falls back to singleLineText when conditionalLookup innerType is missing', () => {
    const field = {
      ...baseField,
      type: 'conditionalLookup',
      options: {},
    } as unknown as IFieldVo;

    const instance = createFieldInstanceByVo(field);

    expect(instance.type).toBe(FieldType.SingleLineText);
    expect(instance.isLookup).toBe(true);
    expect(instance.isConditionalLookup).toBe(true);
    expect(instance.options).toEqual({});
  });
});
