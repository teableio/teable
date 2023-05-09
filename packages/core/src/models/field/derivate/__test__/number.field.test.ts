import type { NumberFieldOptions } from '../number.field';
import { NumberFieldCore } from '../number.field';

describe('NumberFieldCore', () => {
  describe('validateOptions', () => {
    it('should return success if options are valid', () => {
      const options: NumberFieldOptions = {
        precision: 2,
      };
      const field = new NumberFieldCore();
      field.options = options;
      const result = field.validateOptions();
      expect(result.success).toBe(true);
    });

    it('should return failure if options are invalid', () => {
      const options: NumberFieldOptions = {
        precision: -1, // invalid precision value
      };
      const field = new NumberFieldCore();
      field.options = options;
      const result = field.validateOptions();
      expect(result.success).toBe(false);
    });
  });

  describe('validateDefaultValue', () => {
    it('should return success if default value is null', () => {
      const field = new NumberFieldCore();
      field.defaultValue = null as any;
      const result = field.validateDefaultValue();
      expect(result.success).toBe(true);
    });

    it('should return success if default value is a number', () => {
      const field = new NumberFieldCore();
      field.defaultValue = 123.45;
      const result = field.validateDefaultValue();
      expect(result.success).toBe(true);
    });

    it('should return failure if default value is not a number', () => {
      const field = new NumberFieldCore();
      field.defaultValue = 'not a number' as any;
      const result = field.validateDefaultValue();
      expect(result.success).toBe(false);
    });
  });
});
