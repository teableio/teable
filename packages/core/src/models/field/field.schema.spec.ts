import { FieldType } from './constant';
import { NumberFieldCore } from './derivate/number.field';
import { fieldRoSchema, unionFieldOptionsRoSchema } from './field.schema';

describe('field Schema Test', () => {
  it('validates options for fieldRo', () => {
    const options = {
      expression: '1 + 1',
      formatting: {
        precision: 2,
      },
    };

    const result = unionFieldOptionsRoSchema.safeParse(options);
    expect(result.success).toBe(true);
    result.success && expect(result.data).toEqual(options);
  });

  it('validates options with type', () => {
    const fieldRo = {
      type: FieldType.SingleLineText,
      options: NumberFieldCore.defaultOptions(),
    };

    const result = fieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(false);
  });
});
