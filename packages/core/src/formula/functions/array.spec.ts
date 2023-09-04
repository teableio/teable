import { CellValueType } from '../../models/field/constant';
import { TypedValue } from '../typed-value';
import { CountAll } from './array';

describe('ArrayFunc', () => {
  describe('CountAll', () => {
    it('should count items correctly', () => {
      const countAllFunc = new CountAll();

      const result = countAllFunc.eval([
        new TypedValue(1, CellValueType.Number, false),
        new TypedValue(2, CellValueType.Number, false),
        new TypedValue(3, CellValueType.Number, false),
      ]);

      expect(result).toBe(3);
    });

    it('should count items in arrays correctly', () => {
      const countAllFunc = new CountAll();

      const result1 = countAllFunc.eval([
        new TypedValue([1, [2, 3], 4], CellValueType.Number, true),
      ]);
      expect(result1).toBe(4);

      const result2 = countAllFunc.eval([new TypedValue([1, 2, 3], CellValueType.Number, true)]);
      expect(result2).toBe(3);
    });
  });

  it('should count null to 0', () => {
    const countAllFunc = new CountAll();

    const result1 = countAllFunc.eval([new TypedValue(null, CellValueType.Number, true)]);
    expect(result1).toBe(0);

    const result2 = countAllFunc.eval([new TypedValue(null, CellValueType.String)]);
    expect(result2).toBe(0);
  });

  it('should count [null] to 1', () => {
    const countAllFunc = new CountAll();

    const result1 = countAllFunc.eval([new TypedValue([null], CellValueType.Number, true)]);
    expect(result1).toBe(1);

    const result2 = countAllFunc.eval([new TypedValue([[null]], CellValueType.String, true)]);
    expect(result2).toBe(1);
  });
});
