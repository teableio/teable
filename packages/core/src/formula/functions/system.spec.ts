import { CellValueType } from '../../models/field/constant';
import { TypedValue } from '../typed-value';
import { TextAll } from './system';

describe('SystemFunc', () => {
  describe('TextAll', () => {
    it('should process single string correctly', () => {
      const textAllFunc = new TextAll();

      const result = textAllFunc.eval([new TypedValue('Hello', CellValueType.String, false)]);

      expect(result).toBe('Hello');
    });

    it('should process array of strings correctly', () => {
      const textAllFunc = new TextAll();

      const result = textAllFunc.eval([
        new TypedValue(['Hello', 'World'], CellValueType.String, true),
      ]);

      expect(result).toEqual(['Hello', 'World']);
    });

    it('should return null for null input', () => {
      const textAllFunc = new TextAll();

      const result = textAllFunc.eval([new TypedValue(null, CellValueType.String, false)]);

      expect(result).toBeNull();
    });

    it('should throw an error when more than 1 param provided', () => {
      const textAllFunc = new TextAll();

      expect(() =>
        textAllFunc.validateParams([
          new TypedValue('Hello', CellValueType.String, false),
          new TypedValue('World', CellValueType.String, false),
        ])
      ).toThrowError(`${textAllFunc.name} only allow 1 param`);
    });
  });
});
