/* eslint-disable sonarjs/no-duplicate-string */
import { CellValueType } from '../../models/field/constant';
import { TypedValue } from '../typed-value';
import { And, Blank, FormulaBaseError, FormulaError, If, Not, Or, Switch, Xor } from './logical';

describe('LogicalFunc', () => {
  describe('If', () => {
    const ifFunc = new If();

    it('should return the first string when condition is true', () => {
      const result = ifFunc.eval([
        new TypedValue(true, CellValueType.Boolean, false),
        new TypedValue('A', CellValueType.String, false),
        new TypedValue('B', CellValueType.String, false),
      ]);

      expect(result).toBe('A');
    });

    it('should return the second string when condition is false', () => {
      const result = ifFunc.eval([
        new TypedValue(false, CellValueType.Boolean, false),
        new TypedValue('A', CellValueType.String, false),
        new TypedValue('B', CellValueType.String, false),
      ]);

      expect(result).toBe('B');
    });

    it('should return the entire string array when condition is true', () => {
      const multipleStrings = ['A', 'B', 'C'];
      const result = ifFunc.eval([
        new TypedValue(true, CellValueType.Boolean, false),
        new TypedValue(multipleStrings, CellValueType.String, true),
        new TypedValue('B', CellValueType.String, false),
      ]);

      expect(result).toBe(multipleStrings);
    });

    it('should return the entire number array when condition is true', () => {
      const multipleNumbers = [100, 200, 300];
      const result = ifFunc.eval([
        new TypedValue(true, CellValueType.Boolean, false),
        new TypedValue(multipleNumbers, CellValueType.String, true),
        new TypedValue('B', CellValueType.String, false),
      ]);

      expect(result).toBe(multipleNumbers);
    });

    it('should return the entire boolean array when condition is true', () => {
      const multipleBooleans = [true, false, true];
      const result = ifFunc.eval([
        new TypedValue(true, CellValueType.Boolean, false),
        new TypedValue(multipleBooleans, CellValueType.String, true),
        new TypedValue('B', CellValueType.String, false),
      ]);

      expect(result).toBe(multipleBooleans);
    });
  });

  describe('Switch', () => {
    const switchFunc = new Switch();

    it('should return the value corresponding to the matching case', () => {
      const result = switchFunc.eval([
        new TypedValue('Case A', CellValueType.String, false),

        new TypedValue('Case A', CellValueType.String, false),
        new TypedValue('Value A', CellValueType.String, false),

        new TypedValue('Case B', CellValueType.String, false),
        new TypedValue('Value B', CellValueType.String, false),
      ]);

      expect(result).toBe('Value A');
    });

    it('should return the default value when no cases match', () => {
      const result = switchFunc.eval([
        new TypedValue('Case C', CellValueType.String, false),

        new TypedValue('Case A', CellValueType.String, false),
        new TypedValue('Value A', CellValueType.String, false),

        new TypedValue('Case B', CellValueType.String, false),
        new TypedValue('Value B', CellValueType.String, false),

        new TypedValue('Default Value', CellValueType.String, false),
      ]);

      expect(result).toBe('Default Value');
    });

    it('should return the default value when only provide the default value', () => {
      const result = switchFunc.eval([
        new TypedValue('Case A', CellValueType.String, false),
        new TypedValue('Default Value', CellValueType.String, false),
      ]);

      expect(result).toBe('Default Value');
    });

    it('should return the array value corresponding to a string case', () => {
      const result = switchFunc.eval([
        new TypedValue('String', CellValueType.String, false),

        new TypedValue('String', CellValueType.String, false),
        new TypedValue(['A', 'B', 'C'], CellValueType.String, true),

        new TypedValue(123, CellValueType.Number, false),
        new TypedValue([100, 200, 300], CellValueType.Number, true),

        new TypedValue(true, CellValueType.Boolean, false),
        new TypedValue([true, false, true], CellValueType.Boolean, true),

        new TypedValue('Default Value', CellValueType.String, false),
      ]);

      expect(result).toEqual(['A', 'B', 'C']);
    });

    it('should return the array value corresponding to a number case', () => {
      const result = switchFunc.eval([
        new TypedValue(123, CellValueType.Number, false),

        new TypedValue('String', CellValueType.String, false),
        new TypedValue(['A', 'B', 'C'], CellValueType.String, true),

        new TypedValue(123, CellValueType.Number, false),
        new TypedValue([100, 200, 300], CellValueType.Number, true),

        new TypedValue(true, CellValueType.Boolean, false),
        new TypedValue([true, false, true], CellValueType.Boolean, true),

        new TypedValue('Default Value', CellValueType.String, false),
      ]);

      expect(result).toEqual([100, 200, 300]);
    });

    it('should return the array value corresponding to a boolean case', () => {
      const result = switchFunc.eval([
        new TypedValue(true, CellValueType.Boolean, false),

        new TypedValue('String', CellValueType.String, false),
        new TypedValue(['A', 'B', 'C'], CellValueType.String, true),

        new TypedValue(123, CellValueType.Number, false),
        new TypedValue([100, 200, 300], CellValueType.Number, true),

        new TypedValue(true, CellValueType.Boolean, false),
        new TypedValue([true, false, true], CellValueType.Boolean, true),

        new TypedValue('Default Value', CellValueType.String, false),
      ]);

      expect(result).toEqual([true, false, true]);
    });
  });

  describe('And', () => {
    const andFunc = new And();

    it('should do logical AND correctly', () => {
      const result = andFunc.eval([
        new TypedValue(true, CellValueType.Boolean, false),
        new TypedValue(true, CellValueType.Boolean, false),
      ]);

      expect(result).toBe(true);
    });

    it('should do logical AND correctly for arrays', () => {
      const result = andFunc.eval([new TypedValue([true, true], CellValueType.Boolean, true)]);

      expect(result).toBe(true);
    });

    it('should return false if any item is false', () => {
      const result = andFunc.eval([
        new TypedValue(true, CellValueType.Boolean, false),
        new TypedValue(false, CellValueType.Boolean, false),
      ]);

      expect(result).toBe(false);
    });
  });

  describe('Or', () => {
    const orFunc = new Or();

    it('should return true if at least one argument is true', () => {
      const result = orFunc.eval([
        new TypedValue(true, CellValueType.Boolean, false),
        new TypedValue(false, CellValueType.Boolean, false),
      ]);

      expect(result).toBe(true);
    });

    it('should return false if all arguments are false', () => {
      const result = orFunc.eval([
        new TypedValue(false, CellValueType.Boolean, false),
        new TypedValue(false, CellValueType.Boolean, false),
      ]);

      expect(result).toBe(false);
    });

    it('should return true if an array argument contains at least one true value', () => {
      const result = orFunc.eval([new TypedValue([true, false], CellValueType.Boolean, true)]);

      expect(result).toBe(true);
    });

    it('should return false if the all array arguments are false', () => {
      const result = orFunc.eval([new TypedValue([false, false], CellValueType.Boolean, true)]);

      expect(result).toBe(false);
    });
  });

  describe('Xor', () => {
    const xorFunc = new Xor();

    it('should return true when an odd number of the multiple parameters are true', () => {
      const result = xorFunc.eval([
        new TypedValue(true, CellValueType.Boolean, false),
        new TypedValue(false, CellValueType.Boolean, false),
        new TypedValue(false, CellValueType.Boolean, false),
      ]);

      expect(result).toBe(true);
    });

    it('should return false when an even number of the multiple parameters are true', () => {
      const result = xorFunc.eval([
        new TypedValue(true, CellValueType.Boolean, false),
        new TypedValue(false, CellValueType.Boolean, false),
        new TypedValue(true, CellValueType.Boolean, false),
      ]);

      expect(result).toBe(false);
    });

    it('should return true when an odd number of the array arguments are true', () => {
      const result = xorFunc.eval([
        new TypedValue([true, false, false], CellValueType.Boolean, true),
      ]);

      expect(result).toBe(true);
    });

    it('should return false when an even number of the array arguments are true', () => {
      const result = xorFunc.eval([
        new TypedValue([true, false, true], CellValueType.Boolean, true),
      ]);

      expect(result).toBe(false);
    });
  });

  describe('Not', () => {
    const notFunc = new Not();

    it('should return false for a true argument', () => {
      const result = notFunc.eval([new TypedValue(true, CellValueType.Boolean, false)]);

      expect(result).toBe(false);
    });

    it('should return true for a false argument', () => {
      const result = notFunc.eval([new TypedValue(false, CellValueType.Boolean, false)]);

      expect(result).toBe(true);
    });

    it('should return false for an array', () => {
      const result = notFunc.eval([
        new TypedValue([true, false, true], CellValueType.Boolean, true),
      ]);

      expect(result).toBe(false);
    });
  });

  describe('Blank', () => {
    const blankFunc = new Blank();

    it('should return null', () => {
      const result = blankFunc.eval();

      expect(result).toBe(null);
    });
  });

  describe('Error', () => {
    const errorFunc = new FormulaError();

    it('should throw formula error', () => {
      expect(() =>
        errorFunc.eval([new TypedValue('Name', CellValueType.String, false)])
      ).toThrowError(FormulaBaseError);
    });
  });
});
