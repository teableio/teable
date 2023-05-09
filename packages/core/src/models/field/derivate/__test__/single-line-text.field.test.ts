import { SingleLineTextFieldCore } from '../single-line-text.field';

describe('SingleLineTextFieldCore', () => {
  describe('validateOptions', () => {
    it('should return success if options are null', () => {
      const field = new SingleLineTextFieldCore();
      field.options = null;
      const result = field.validateOptions();
      expect(result.success).toBe(true);
    });

    it('should return failure if options are not null', () => {
      const field = new SingleLineTextFieldCore();
      field.options = {} as any; // empty object
      const result = field.validateOptions();
      expect(result.success).toBe(false);
    });
  });

  describe('validateDefaultValue', () => {
    it('should return success if default value is null', () => {
      const field = new SingleLineTextFieldCore();
      field.defaultValue = null as any;
      const result = field.validateDefaultValue();
      expect(result.success).toBe(true);
    });

    it('should return success if default value is a string', () => {
      const field = new SingleLineTextFieldCore();
      field.defaultValue = 'default value';
      const result = field.validateDefaultValue();
      expect(result.success).toBe(true);
    });

    it('should return failure if default value is not a string', () => {
      const field = new SingleLineTextFieldCore();
      field.defaultValue = 123 as any; // not a string
      const result = field.validateDefaultValue();
      expect(result.success).toBe(false);
    });
  });
});
