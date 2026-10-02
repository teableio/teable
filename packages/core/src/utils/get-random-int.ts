/**
 * Uniform float in [0, 1) drawn from the platform CSPRNG. Web Crypto is a global in browsers
 * and in Node.js >= 19; runtimes without it (React Native without a polyfill) fall back to
 * Math.random, which is acceptable because no caller uses this for secrets or tokens.
 */
export function getRandomFloat(): number {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    return webCrypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  }
  return Math.random(); // NOSONAR typescript:S2245 -- non-security fallback for runtimes without Web Crypto
}

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
  return Math.floor(getRandomFloat() * (max - min + 1)) + min;
}
