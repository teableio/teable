/**
 * Randomness for jitter/identifier suffixes.
 *
 * `node:crypto` cannot be imported by a browser bundle at all, while
 * `globalThis.crypto` (WebCrypto) exists in every supported runtime: Node >= 22
 * and all browsers. Keeping the call here means adapters stay platform-neutral
 * without an environment switch.
 */
const randomUint32 = (): number => {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0];
};

/** Uniform integer in `[0, exclusiveMax)`. */
export const randomIntBelow = (exclusiveMax: number): number => {
  if (!Number.isFinite(exclusiveMax) || exclusiveMax <= 1) {
    return 0;
  }
  const max = Math.floor(exclusiveMax);
  // Rejection sampling keeps the distribution uniform for non-power-of-two max.
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  let value = randomUint32();
  while (value >= limit) {
    value = randomUint32();
  }
  return value % max;
};

/** Lowercase hex identifier of `byteLength` random bytes. */
export const randomHex = (byteLength: number): string => {
  const bytes = new Uint8Array(Math.max(0, Math.trunc(byteLength)));
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};
