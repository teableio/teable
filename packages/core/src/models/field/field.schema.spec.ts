import { unionFieldOptionsRoSchema } from './field.schema';

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
});
