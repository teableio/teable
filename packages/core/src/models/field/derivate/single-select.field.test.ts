import { Colors } from '../colors';
import type { SelectFieldOptions } from './select.field.abstract';
import { SingleSelectFieldCore } from './single-select.field';

describe('SingleSelectFieldCore', () => {
  describe('validateOptions', () => {
    it('should return success if options are valid', () => {
      const options: SelectFieldOptions = {
        choices: [
          { name: 'Option 1', color: Colors.Blue },
          { name: 'Option 2', color: Colors.Red },
        ],
      };
      const field = new SingleSelectFieldCore();
      field.options = options;
      const result = field.validateOptions();
      expect(result.success).toBe(true);
    });

    it('should return failure if options are invalid', () => {
      const options: any = {
        // missing choices property
      };
      const field = new SingleSelectFieldCore();
      field.options = options;
      const result = field.validateOptions();
      expect(result.success).toBe(false);
    });
  });

  describe('validateDefaultValue', () => {
    it('should return success if default value is null', () => {
      const field = new SingleSelectFieldCore();
      field.options = {
        choices: [],
      };
      field.defaultValue = null as any;
      const result = field.validateDefaultValue();
      expect(result.success).toBe(true);
    });

    it('should return success if default value is one of the choice names', () => {
      const field = new SingleSelectFieldCore();
      field.options = {
        choices: [
          { name: 'Option 1', color: Colors.Blue },
          { name: 'Option 2', color: Colors.Red },
        ],
      };
      field.defaultValue = 'Option 1';
      const result = field.validateDefaultValue();
      expect(result.success).toBe(true);
    });

    it('should return failure if default value is not one of the choice names', () => {
      const field = new SingleSelectFieldCore();
      field.options = {
        choices: [
          { name: 'Option 1', color: Colors.Blue },
          { name: 'Option 2', color: Colors.Red },
        ],
      };
      field.defaultValue = 'Option 3';
      const result = field.validateDefaultValue();
      expect(result.success).toBe(false);
    });
  });
});
