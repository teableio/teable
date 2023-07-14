import { getRandomInt } from './get-random-int';

describe('getRandomInt tests', () => {
  it('should return an integer between min and max', () => {
    expect([100, 101].includes(getRandomInt(100, 101))).toBeTruthy();
    expect([-101, -100].includes(getRandomInt(-101, -100))).toBeTruthy();
  });

  it('should throw if not a number', () => {
    expect(() => getRandomInt(NaN, 100)).toThrow(/min/i);
    expect(() => getRandomInt(10, {} as unknown as number)).toThrow(/max/i);
  });

  it('should throw if min > max', () => {
    expect(() => getRandomInt(100, 10)).toThrow(/greater/i);
  });
});
