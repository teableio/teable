import { CellValueType } from '../../models/field/constant';
import { TypedValue } from '../typed-value';
import { Concatenate } from './text';

describe('TextFunc', () => {
  describe('Concatenate', () => {
    it('should concatenate strings correctly', () => {
      const concatenateFunc = new Concatenate();

      const result = concatenateFunc.eval([
        new TypedValue('Hello ', CellValueType.String, false),
        new TypedValue('World', CellValueType.String, false),
      ]);

      expect(result).toBe('Hello World');
    });

    it('should concatenate strings in arrays correctly', () => {
      const concatenateFunc = new Concatenate();

      const result = concatenateFunc.eval([
        new TypedValue(['Hello ', 'World'], CellValueType.String, true),
      ]);

      expect(result).toBe('Hello World');
    });
  });
});
