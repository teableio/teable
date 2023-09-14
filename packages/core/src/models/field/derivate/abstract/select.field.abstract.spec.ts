import { selectFieldOptionsRoSchema, selectFieldOptionsSchema } from './select.field.abstract';

describe('select field schema test', () => {
  it('should return true when options validate', () => {
    const options = {
      choices: [{ name: 'name' }],
    };

    const result = selectFieldOptionsRoSchema.safeParse(options);
    expect(result.success).toBe(true);
    result.success && expect(result.data).toEqual(options);
  });

  it('should return false when options invalidate', () => {
    const options = {
      choices: [{ name: 'name' }],
    };

    const result = selectFieldOptionsSchema.safeParse(options);
    expect(result.success).toBe(false);
  });
});
