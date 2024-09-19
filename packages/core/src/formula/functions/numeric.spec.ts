/* eslint-disable sonarjs/no-duplicate-string */
import { CellValueType } from '../../models/field/constant';
import { TypedValue } from '../typed-value';
import {
  Abs,
  Average,
  Ceiling,
  Even,
  Exp,
  Floor,
  Int,
  Log,
  Max,
  Min,
  Mod,
  Odd,
  Power,
  Round,
  RoundDown,
  RoundUp,
  Sqrt,
  Sum,
  Value,
} from './numeric';

describe('Numeric', () => {
  describe('Sum', () => {
    const sumFunc = new Sum();

    it('should sum numbers correctly', () => {
      const result = sumFunc.eval([
        new TypedValue(1, CellValueType.Number, false),
        new TypedValue(2, CellValueType.Number, false),
        new TypedValue(3, CellValueType.Number, false),
      ]);

      expect(result).toBe(6);
    });

    it('should sum numbers in arrays correctly', () => {
      const result = sumFunc.eval([new TypedValue([1, 2, 3], CellValueType.Number, true)]);

      expect(result).toBe(6);
    });
  });

  describe('Average', () => {
    const averageFunc = new Average();

    it('should average numbers correctly', () => {
      const result = averageFunc.eval([
        new TypedValue(1, CellValueType.Number, false),
        new TypedValue(2, CellValueType.Number, false),
        new TypedValue(3, CellValueType.Number, false),
      ]);

      expect(result).toBe(2);
    });

    it('should average numbers in arrays correctly', () => {
      const result = averageFunc.eval([new TypedValue([1, 2, 3], CellValueType.Number, true)]);

      expect(result).toBe(2);
    });
  });

  describe('Max', () => {
    const maxFunc = new Max();

    it('should max numbers correctly', () => {
      const result = maxFunc.eval([
        new TypedValue(1, CellValueType.Number, false),
        new TypedValue(2, CellValueType.Number, false),
        new TypedValue(3, CellValueType.Number, false),
      ]);

      expect(result).toBe(3);
    });

    it('should max numbers in arrays correctly', () => {
      const result = maxFunc.eval([new TypedValue([1, 2, 3], CellValueType.Number, true)]);

      expect(result).toBe(3);
    });

    it('should max datetime correctly', () => {
      const result = maxFunc.eval([
        new TypedValue('2024-01-01T00:00:00.000Z', CellValueType.DateTime, false),
        new TypedValue('2024-01-02T00:00:00.000Z', CellValueType.DateTime, false),
        new TypedValue('2024-01-03T00:00:00.000Z', CellValueType.DateTime, false),
      ]);

      expect(result).toBe('2024-01-03T00:00:00.000Z');
    });
  });

  describe('Min', () => {
    const minFunc = new Min();

    it('should min numbers correctly', () => {
      const result = minFunc.eval([
        new TypedValue(1, CellValueType.Number, false),
        new TypedValue(2, CellValueType.Number, false),
        new TypedValue(3, CellValueType.Number, false),
      ]);

      expect(result).toBe(1);
    });

    it('should min numbers in arrays correctly', () => {
      const result = minFunc.eval([new TypedValue([1, 2, 3], CellValueType.Number, true)]);

      expect(result).toBe(1);
    });

    it('should min datetime correctly', () => {
      const result = minFunc.eval([
        new TypedValue('2024-01-01T00:00:00.000Z', CellValueType.DateTime, false),
        new TypedValue('2024-01-02T00:00:00.000Z', CellValueType.DateTime, false),
        new TypedValue('2024-01-03T00:00:00.000Z', CellValueType.DateTime, false),
      ]);

      expect(result).toBe('2024-01-01T00:00:00.000Z');
    });
  });

  describe('Round', () => {
    const roundFunc = new Round();

    it('should round number with default precision', () => {
      const result = roundFunc.eval([new TypedValue(2.49, CellValueType.Number, false)]);

      expect(result).toBe(2);
    });

    it('should round number when precision is 0', () => {
      const result = roundFunc.eval([
        new TypedValue(2.49, CellValueType.Number, false),
        new TypedValue(0, CellValueType.Number, false),
      ]);

      expect(result).toBe(2);
    });

    it('should round negative number when precision is 1', () => {
      const result = roundFunc.eval([
        new TypedValue(-2.55, CellValueType.Number, false),
        new TypedValue(1, CellValueType.Number, false),
      ]);

      expect(result).toBe(-2.5);
    });

    it('should round negative number when precision is 1', () => {
      const result = roundFunc.eval([
        new TypedValue(-2.49, CellValueType.Number, false),
        new TypedValue(1, CellValueType.Number, false),
      ]);

      expect(result).toBe(-2.5);
    });

    it('should round number when precision is greater than 1 but less than 2', () => {
      const result = roundFunc.eval([
        new TypedValue(2.49, CellValueType.Number, false),
        new TypedValue(1.8, CellValueType.Number, false),
      ]);

      expect(result).toBe(2.5);
    });

    it('should round number when precision is 2', () => {
      const result = roundFunc.eval([
        new TypedValue(2.494, CellValueType.Number, false),
        new TypedValue(2, CellValueType.Number, false),
      ]);

      expect(result).toBe(2.49);
    });
  });

  describe('RoundUp', () => {
    const roundUpFunc = new RoundUp();

    it('should round up number with default precision', () => {
      const result = roundUpFunc.eval([new TypedValue(2.49, CellValueType.Number, false)]);

      expect(result).toBe(3);
    });

    it('should round up number when precision is 0', () => {
      const result = roundUpFunc.eval([
        new TypedValue(2.49, CellValueType.Number, false),
        new TypedValue(0, CellValueType.Number, false),
      ]);

      expect(result).toBe(3);
    });

    it('should round up number when precision is 1', () => {
      const result = roundUpFunc.eval([
        new TypedValue(2.44, CellValueType.Number, false),
        new TypedValue(1, CellValueType.Number, false),
      ]);

      expect(result).toBe(2.5);
    });

    it('should round up number when precision is -1', () => {
      const result = roundUpFunc.eval([
        new TypedValue(2.49, CellValueType.Number, false),
        new TypedValue(-1, CellValueType.Number, false),
      ]);

      expect(result).toBe(10);
    });

    it('should round up negative number when precision is 0', () => {
      const result = roundUpFunc.eval([
        new TypedValue(-2.49, CellValueType.Number, false),
        new TypedValue(0, CellValueType.Number, false),
      ]);

      expect(result).toBe(-3);
    });

    it('should round up negative number when precision is 1', () => {
      const result = roundUpFunc.eval([
        new TypedValue(-2.49, CellValueType.Number, false),
        new TypedValue(1, CellValueType.Number, false),
      ]);

      expect(result).toBe(-2.5);
    });

    it('should round up negative number when precision is -1', () => {
      const result = roundUpFunc.eval([
        new TypedValue(-2.49, CellValueType.Number, false),
        new TypedValue(-1, CellValueType.Number, false),
      ]);

      expect(result).toBe(-10);
    });
  });

  describe('RoundDown', () => {
    const roundDownFunc = new RoundDown();

    it('should round down number with default precision', () => {
      const result = roundDownFunc.eval([new TypedValue(2.49, CellValueType.Number, false)]);

      expect(result).toBe(2);
    });

    it('should round down number when precision is 0', () => {
      const result = roundDownFunc.eval([
        new TypedValue(2.49, CellValueType.Number, false),
        new TypedValue(0, CellValueType.Number, false),
      ]);

      expect(result).toBe(2);
    });

    it('should round down number when precision is 1', () => {
      const result = roundDownFunc.eval([
        new TypedValue(2.49, CellValueType.Number, false),
        new TypedValue(1, CellValueType.Number, false),
      ]);

      expect(result).toBe(2.4);
    });

    it('should round down number when precision is -1', () => {
      const result = roundDownFunc.eval([
        new TypedValue(2.49, CellValueType.Number, false),
        new TypedValue(-1, CellValueType.Number, false),
      ]);

      expect(result).toBe(0);
    });

    it('should round down negative number when precision is 0', () => {
      const result = roundDownFunc.eval([
        new TypedValue(-2.49, CellValueType.Number, false),
        new TypedValue(0, CellValueType.Number, false),
      ]);

      expect(result).toBe(-2);
    });

    it('should round down negative number when precision is 1', () => {
      const result = roundDownFunc.eval([
        new TypedValue(-2.49, CellValueType.Number, false),
        new TypedValue(1, CellValueType.Number, false),
      ]);

      expect(result).toBe(-2.4);
    });

    it('should round down negative number when precision is -1', () => {
      const result = roundDownFunc.eval([
        new TypedValue(-2.49, CellValueType.Number, false),
        new TypedValue(-1, CellValueType.Number, false),
      ]);

      expect(result).toBe(-0);
    });
  });

  describe('Ceiling', () => {
    const ceilingFunc = new Ceiling();

    it('should ceiling number with default precision', () => {
      const result = ceilingFunc.eval([new TypedValue(2.49, CellValueType.Number, false)]);

      expect(result).toBe(3);
    });

    it('should ceiling number when precision is 0', () => {
      const result = ceilingFunc.eval([
        new TypedValue(2.49, CellValueType.Number, false),
        new TypedValue(0, CellValueType.Number, false),
      ]);

      expect(result).toBe(3);
    });

    it('should ceiling number when precision is 1', () => {
      const result = ceilingFunc.eval([
        new TypedValue(2.44, CellValueType.Number, false),
        new TypedValue(1, CellValueType.Number, false),
      ]);

      expect(result).toBe(2.5);
    });

    it('should ceiling number when precision is -1', () => {
      const result = ceilingFunc.eval([
        new TypedValue(2.49, CellValueType.Number, false),
        new TypedValue(-1, CellValueType.Number, false),
      ]);

      expect(result).toBe(10);
    });

    it('should ceiling negative number when precision is 0', () => {
      const result = ceilingFunc.eval([
        new TypedValue(-2.49, CellValueType.Number, false),
        new TypedValue(0, CellValueType.Number, false),
      ]);

      expect(result).toBe(-2);
    });

    it('should ceiling negative number when precision is 1', () => {
      const result = ceilingFunc.eval([
        new TypedValue(-2.49, CellValueType.Number, false),
        new TypedValue(1, CellValueType.Number, false),
      ]);

      expect(result).toBe(-2.4);
    });

    it('should ceiling negative number when precision is -1', () => {
      const result = ceilingFunc.eval([
        new TypedValue(-2.49, CellValueType.Number, false),
        new TypedValue(-1, CellValueType.Number, false),
      ]);

      expect(result).toBe(-0);
    });
  });

  describe('Floor', () => {
    const floorFunc = new Floor();

    it('should floor number with default precision', () => {
      const result = floorFunc.eval([new TypedValue(2.49, CellValueType.Number, false)]);

      expect(result).toBe(2);
    });

    it('should floor number when precision is 0', () => {
      const result = floorFunc.eval([
        new TypedValue(2.49, CellValueType.Number, false),
        new TypedValue(0, CellValueType.Number, false),
      ]);

      expect(result).toBe(2);
    });

    it('should floor number when precision is 1', () => {
      const result = floorFunc.eval([
        new TypedValue(2.44, CellValueType.Number, false),
        new TypedValue(1, CellValueType.Number, false),
      ]);

      expect(result).toBe(2.4);
    });

    it('should floor number when precision is -1', () => {
      const result = floorFunc.eval([
        new TypedValue(2.49, CellValueType.Number, false),
        new TypedValue(-1, CellValueType.Number, false),
      ]);

      expect(result).toBe(0);
    });

    it('should floor negative number when precision is 0', () => {
      const result = floorFunc.eval([
        new TypedValue(-2.49, CellValueType.Number, false),
        new TypedValue(0, CellValueType.Number, false),
      ]);

      expect(result).toBe(-3);
    });

    it('should floor negative number when precision is 1', () => {
      const result = floorFunc.eval([
        new TypedValue(-2.49, CellValueType.Number, false),
        new TypedValue(1, CellValueType.Number, false),
      ]);

      expect(result).toBe(-2.5);
    });

    it('should floor negative number when precision is -1', () => {
      const result = floorFunc.eval([
        new TypedValue(-2.49, CellValueType.Number, false),
        new TypedValue(-1, CellValueType.Number, false),
      ]);

      expect(result).toBe(-10);
    });
  });

  describe('Even', () => {
    const evenFunc = new Even();

    it('should round up to nearest even number for positive decimal values', () => {
      const result = evenFunc.eval([new TypedValue(0.1, CellValueType.Number, false)]);

      expect(result).toBe(2);
    });

    it('should round down to nearest even number for negative decimal values', () => {
      const result = evenFunc.eval([new TypedValue(-0.1, CellValueType.Number, false)]);

      expect(result).toBe(-2);
    });

    it('should return 0 for input value of 0', () => {
      const result = evenFunc.eval([new TypedValue(0, CellValueType.Number, false)]);

      expect(result).toBe(0);
    });

    it('should return 2 for input value of 2', () => {
      const result = evenFunc.eval([new TypedValue(2, CellValueType.Number, false)]);

      expect(result).toBe(2);
    });
  });

  describe('Odd', () => {
    const oddFunc = new Odd();

    it('should round up to nearest odd number for positive decimal values', () => {
      const result = oddFunc.eval([new TypedValue(0.1, CellValueType.Number, false)]);

      expect(result).toBe(1);
    });

    it('should round down to nearest even number for negative decimal values', () => {
      const result = oddFunc.eval([new TypedValue(-0.1, CellValueType.Number, false)]);

      expect(result).toBe(-1);
    });

    it('should return 0 for input value of 0', () => {
      const result = oddFunc.eval([new TypedValue(0, CellValueType.Number, false)]);

      expect(result).toBe(1);
    });

    it('should return 3 for input value of 3', () => {
      const result = oddFunc.eval([new TypedValue(3, CellValueType.Number, false)]);

      expect(result).toBe(3);
    });
  });

  describe('Int', () => {
    const intFunc = new Int();

    it('should return the integer part for positive number', () => {
      const result = intFunc.eval([new TypedValue(1.9, CellValueType.Number, false)]);

      expect(result).toBe(1);
    });

    it('should return the integer part for negative numbers rounded towards zero', () => {
      const result = intFunc.eval([new TypedValue(-1.9, CellValueType.Number, false)]);

      expect(result).toBe(-2);
    });
  });

  describe('Abs', () => {
    const absFunc = new Abs();

    it('should return the absolute value of a positive number', () => {
      const result = absFunc.eval([new TypedValue(1, CellValueType.Number, false)]);

      expect(result).toBe(1);
    });

    it('should return the absolute value of a negative number', () => {
      const result = absFunc.eval([new TypedValue(-1, CellValueType.Number, false)]);

      expect(result).toBe(1);
    });
  });

  describe('Sqrt', () => {
    const sqrtFunc = new Sqrt();

    it('should return the square root of a positive number', () => {
      const result = sqrtFunc.eval([new TypedValue(4, CellValueType.Number, false)]);

      expect(result).toBe(2);
    });

    it('should return NaN for a positive number', () => {
      const result = sqrtFunc.eval([new TypedValue(-1, CellValueType.Number, false)]);

      expect(result).toBe(NaN);
    });
  });

  describe('Power', () => {
    const powerFunc = new Power();

    it('should return the result of raising a positive base to a positive exponent', () => {
      const result = powerFunc.eval([
        new TypedValue(10, CellValueType.Number, false),
        new TypedValue(2, CellValueType.Number, false),
      ]);

      expect(result).toBe(100);
    });

    it('should return the result of raising a positive base to a negative exponent', () => {
      const result = powerFunc.eval([
        new TypedValue(10, CellValueType.Number, false),
        new TypedValue(-2, CellValueType.Number, false),
      ]);

      expect(result).toBe(0.01);
    });

    it('should return the result of raising a negative base to a positive exponent', () => {
      const result = powerFunc.eval([
        new TypedValue(-10, CellValueType.Number, false),
        new TypedValue(2, CellValueType.Number, false),
      ]);

      expect(result).toBe(100);
    });
  });

  describe('Exp', () => {
    const expFunc = new Exp();

    it('should return Euler number when the exponent is 1', () => {
      const result = expFunc.eval([new TypedValue(1, CellValueType.Number, false)]);

      expect(result).toBe(Math.E);
    });

    it('should return 1 when the exponent is 0', () => {
      const result = expFunc.eval([new TypedValue(0, CellValueType.Number, false)]);

      expect(result).toBe(1);
    });
  });

  describe('Log', () => {
    const logFunc = new Log();

    it('should return the logarithm of a number with a specified base', () => {
      const result = logFunc.eval([
        new TypedValue(1024, CellValueType.Number, false),
        new TypedValue(2, CellValueType.Number, false),
      ]);

      expect(result).toBe(10);
    });

    it('should return the natural logarithm when no base is specified', () => {
      const result = logFunc.eval([new TypedValue(100, CellValueType.Number, false)]);

      expect(result).toBe(2);
    });
  });

  describe('Mod', () => {
    const modFunc = new Mod();

    it('should return the modulus of two positive numbers where the divisor is less than the dividend', () => {
      const result = modFunc.eval([
        new TypedValue(3, CellValueType.Number, false),
        new TypedValue(2, CellValueType.Number, false),
      ]);

      expect(result).toBe(1);
    });

    it('should return zero when the divisor is equal to the dividend', () => {
      const result = modFunc.eval([
        new TypedValue(3, CellValueType.Number, false),
        new TypedValue(3, CellValueType.Number, false),
      ]);

      expect(result).toBe(0);
    });

    it('should return the modulus of a negative dividend and a positive divisor', () => {
      const result = modFunc.eval([
        new TypedValue(-5, CellValueType.Number, false),
        new TypedValue(2, CellValueType.Number, false),
      ]);

      expect(result).toBe(1);
    });
  });

  describe('Value', () => {
    const valueFunc = new Value();

    it('should convert a positive string to its numeric value', () => {
      const result = valueFunc.eval([new TypedValue('100', CellValueType.Number, false)]);

      expect(result).toBe(100);
    });

    it('should convert a negative string to its numeric value', () => {
      const result = valueFunc.eval([new TypedValue('-100', CellValueType.Number, false)]);

      expect(result).toBe(-100);
    });

    it('should extract numeric value from a string with leading non-numeric characters', () => {
      const result = valueFunc.eval([new TypedValue('abc-100.12$$3', CellValueType.Number, false)]);

      expect(result).toBe(-100.123);
    });

    it('should throw an error when param is not a string', () => {
      expect(() =>
        valueFunc.validateParams([new TypedValue(100, CellValueType.Number, false)])
      ).toThrowError(`${valueFunc.name} can't process string type param at 1`);
    });
  });
});
