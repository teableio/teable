import { selectFieldOptionsRoSchema, selectFieldOptionsSchema } from './select.field.abstract';

describe('select field schema test', () => {
  it('should return true when ro options validate', () => {
    const options = {
      choices: [{ name: 'name' }],
    };

    const result = selectFieldOptionsRoSchema.safeParse(options);
    expect(result.success).toBe(true);
    result.success && expect(result.data).toEqual(options);
  });

  it('should return false when ro options invalidate', () => {
    expect(
      selectFieldOptionsRoSchema.safeParse({
        choices: [{ name: '' }],
      }).success
    ).toBe(false);

    expect(
      selectFieldOptionsRoSchema.safeParse({
        choices: [{ id: 'cho' }],
      }).success
    ).toBe(false);

    expect(
      selectFieldOptionsRoSchema.safeParse({
        choices: [{ name: 'name', color: '#000000' }],
      }).success
    ).toBe(false);
  });

  it('should return false when vo options invalidate', () => {
    const options = {
      choices: [{ name: 'name' }],
    };

    const result = selectFieldOptionsSchema.safeParse(options);
    expect(result.success).toBe(false);
  });
});
