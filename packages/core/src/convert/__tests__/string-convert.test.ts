import { stringToFloat, stringToSafeInteger } from '../';

describe('StringConvert tests', () => {
  describe('stringtoSafeInteger', () => {
    it('should work as expected', () => {
      expect(stringToSafeInteger('')).toStrictEqual(null);
      expect(stringToSafeInteger(10)).toStrictEqual(10);
      expect(stringToSafeInteger('10')).toStrictEqual(10);
      expect(stringToSafeInteger('32568888')).toStrictEqual(32568888);
      expect(stringToSafeInteger('10.2')).toStrictEqual(null);
      expect(stringToSafeInteger(null)).toStrictEqual(null);
      expect(stringToSafeInteger('-3')).toStrictEqual(-3);
      expect(stringToSafeInteger(undefined)).toStrictEqual(null);
      expect(stringToSafeInteger(null)).toStrictEqual(null);
      expect(stringToSafeInteger(false)).toStrictEqual(null);
      expect(stringToSafeInteger(NaN)).toStrictEqual(null);
    });
  });

  describe('stringToFloat', () => {
    it('should work as expected', () => {
      expect(stringToFloat(10)).toStrictEqual(10);
      expect(stringToFloat('10.2345')).toStrictEqual(10.2345);
      expect(stringToFloat('.2')).toStrictEqual(0.2);
      expect(stringToFloat('-10.234')).toStrictEqual(-10.234);
      expect(stringToFloat(undefined)).toStrictEqual(null);
      expect(stringToFloat(null)).toStrictEqual(null);
      expect(stringToFloat(NaN)).toStrictEqual(null);
      expect(stringToFloat(false)).toStrictEqual(null);
    });
  });
});
