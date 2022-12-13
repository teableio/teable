/**
 * Returns a random integer between min (inclusive) and max (inclusive).
 * The value is no lower than min (or the next integer greater than min
 * if min isn't an integer) and no greater than max (or the next integer
 * lower than max if max isn't an integer).
 * @link https://stackoverflow.com/questions/1527803/generating-random-whole-numbers-in-javascript-in-a-specific-range/1527820#1527820
 */

export function getRandomInt(min: number, max: number): number {
  [min, max].forEach((v, idx) => {
    if (!Number.isSafeInteger(v)) {
      throw new Error(`${idx === 0 ? 'min' : 'max'} is not a valid integer`);
    }
  });
  if (max < min) {
    throw new Error('Min cannot be greater than max');
  }
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
