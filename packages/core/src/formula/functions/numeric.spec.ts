import { CellValueType } from '../../models/field/constant';
import { TypedValue } from '../typed-value';
import { Sum } from './numeric';

describe('Numeric', () => {
  describe('Sum', () => {
    it('should sum numbers correctly', () => {
      const sumFunc = new Sum();

      const result = sumFunc.eval([
        new TypedValue(1, CellValueType.Number, false),
        new TypedValue(2, CellValueType.Number, false),
        new TypedValue(3, CellValueType.Number, false),
      ]);

      expect(result).toBe(6);
    });

    it('should sum numbers in arrays correctly', () => {
      const sumFunc = new Sum();

      const result = sumFunc.eval([new TypedValue([1, 2, 3], CellValueType.Number, true)]);

      expect(result).toBe(6);
    });
  });
});
