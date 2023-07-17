import { CellValueType } from '../../models/field/constant';
import { TypedValue } from '../typed-value';
import { And } from './logical';

describe('LogicalFunc', () => {
  describe('And', () => {
    it('should do logical AND correctly', () => {
      const andFunc = new And();

      const result = andFunc.eval([
        new TypedValue(true, CellValueType.Boolean, false),
        new TypedValue(true, CellValueType.Boolean, false),
      ]);

      expect(result).toBe(true);
    });

    it('should do logical AND correctly for arrays', () => {
      const andFunc = new And();

      const result = andFunc.eval([new TypedValue([true, true], CellValueType.Boolean, true)]);

      expect(result).toBe(true);
    });

    it('should return false if any item is false', () => {
      const andFunc = new And();

      const result = andFunc.eval([
        new TypedValue(true, CellValueType.Boolean, false),
        new TypedValue(false, CellValueType.Boolean, false),
      ]);

      expect(result).toBe(false);
    });
  });
});
