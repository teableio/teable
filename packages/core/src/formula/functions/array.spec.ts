import { CellValueType } from '../../models/field/constant';
import { TypedValue } from '../typed-value';
import {
  ArrayCompact,
  ArrayFlatten,
  ArrayJoin,
  ArrayUnique,
  Count,
  CountA,
  CountAll,
} from './array';

describe('ArrayFunc', () => {
  describe('CountAll', () => {
    const countAllFunc = new CountAll();
    it('should count items in arrays correctly', () => {
      const result1 = countAllFunc.eval([
        new TypedValue([1, [2, 3], 4], CellValueType.Number, true),
      ]);
      expect(result1).toBe(3);

      const result2 = countAllFunc.eval([new TypedValue([1, 2, 3], CellValueType.Number, true)]);
      expect(result2).toBe(3);
    });

    it('should count null to 0', () => {
      const result1 = countAllFunc.eval([new TypedValue(null, CellValueType.Number, false)]);
      expect(result1).toBe(0);

      const result2 = countAllFunc.eval([new TypedValue(null, CellValueType.String, false)]);
      expect(result2).toBe(0);
    });

    it('should count [null] to 1', () => {
      const result1 = countAllFunc.eval([new TypedValue([null], CellValueType.Number, true)]);
      expect(result1).toBe(1);

      const result2 = countAllFunc.eval([new TypedValue([[null]], CellValueType.String, true)]);
      expect(result2).toBe(1);
    });
  });

  describe('CountA', () => {
    const countAFunc = new CountA();

    it('should count non-empty values in array', () => {
      const result = countAFunc.eval([new TypedValue([1, 2, null], CellValueType.Number, true)]);

      expect(result).toBe(2);
    });

    it('should count non-empty values in nested array', () => {
      const result = countAFunc.eval([
        new TypedValue([1, 2, [null, 3]], CellValueType.Number, true),
      ]);

      expect(result).toBe(3);
    });

    it('should count non-empty values in multiple params', () => {
      const result = countAFunc.eval([
        new TypedValue([1, 2, 3, null], CellValueType.Number, true),
        new TypedValue(1, CellValueType.Number, false),
      ]);

      expect(result).toBe(4);
    });

    it('should count numbers example', () => {
      const result = countAFunc.eval([
        new TypedValue(100, CellValueType.Number, false),
        new TypedValue(200, CellValueType.Number, false),
        new TypedValue(300, CellValueType.Number, false),
        new TypedValue('', CellValueType.String, false),
        new TypedValue('Teable', CellValueType.String, false),
        new TypedValue(true, CellValueType.Boolean, false),
      ]);

      expect(result).toBe(4);
    });
  });

  describe('Count', () => {
    const countFunc = new Count();

    it('should count numbers in array', () => {
      const result = countFunc.eval([new TypedValue([1, 2, null], CellValueType.Number, true)]);

      expect(result).toBe(2);
    });

    it('should count numbers in multiple params', () => {
      const result = countFunc.eval([
        new TypedValue([1, 2, 'A', 'B'], CellValueType.Number, true),
        new TypedValue(3, CellValueType.Number, false),
      ]);

      expect(result).toBe(3);
    });

    it('should count numbers example', () => {
      const result = countFunc.eval([
        new TypedValue(100, CellValueType.Number, false),
        new TypedValue(200, CellValueType.Number, false),
        new TypedValue(300, CellValueType.Number, false),
        new TypedValue('', CellValueType.String, false),
        new TypedValue('Teable', CellValueType.String, false),
        new TypedValue(true, CellValueType.Boolean, false),
      ]);

      expect(result).toBe(3);
    });
  });

  describe('ArrayJoin', () => {
    const arrayJoinFunc = new ArrayJoin();

    it('should join array elements with default separator', () => {
      const result = arrayJoinFunc.eval([
        new TypedValue(['A', 'B', 'C'], CellValueType.String, true),
      ]);

      expect(result).toBe('A, B, C');
    });

    it('should join array elements with custom separator', () => {
      const result = arrayJoinFunc.eval([
        new TypedValue(['A', 'B', 'C'], CellValueType.String, true),
        new TypedValue('-', CellValueType.String, false),
      ]);

      expect(result).toBe('A-B-C');
    });
  });

  describe('ArrayUnique', () => {
    const arrayUniqueFunc = new ArrayUnique();

    it('should remove duplicates in array', () => {
      const result = arrayUniqueFunc.eval([
        new TypedValue(['A', 'B', 'C', ['D'], 'B'], CellValueType.String, true),
      ]);

      expect(result).toEqual(['A', 'B', 'C', 'D']);
    });

    it('should remove duplicates in array and value', () => {
      const result = arrayUniqueFunc.eval([
        new TypedValue(['A', 'B', 'C', ['D']], CellValueType.String, true),
        new TypedValue('B', CellValueType.String, false),
      ]);

      expect(result).toEqual(['A', 'B', 'C', 'D']);
    });
  });

  describe('ArrayFlatten', () => {
    const arrayFlattenFunc = new ArrayFlatten();

    it('should flatten nested array', () => {
      const result = arrayFlattenFunc.eval([
        new TypedValue(['A', 'B', 'C', ['D']], CellValueType.String, true),
      ]);

      expect(result).toEqual(['A', 'B', 'C', 'D']);
    });

    it('should flatten nested array and concat value', () => {
      const result = arrayFlattenFunc.eval([
        new TypedValue(['A', 'B', 'C', ['D']], CellValueType.String, true),
        new TypedValue('ABC', CellValueType.String, false),
      ]);

      expect(result).toEqual(['A', 'B', 'C', 'D', 'ABC']);
    });
  });

  describe('ArrayCompact', () => {
    const arrayCompactFunc = new ArrayCompact();

    it('should remove empty values from array', () => {
      const result = arrayCompactFunc.eval([
        new TypedValue(['A', 'B', '', null], CellValueType.String, true),
      ]);

      expect(result).toEqual(['A', 'B']);
    });

    it('should remove empty values from array and values', () => {
      const result = arrayCompactFunc.eval([
        new TypedValue(['A', 'B', '', null], CellValueType.String, true),
        new TypedValue('C', CellValueType.String, false),
      ]);

      expect(result).toEqual(['A', 'B', 'C']);
    });
  });
});
