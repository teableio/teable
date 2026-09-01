export interface IRecordBloom {
  /** bit count */
  m: number;
  /** hash count */
  k: number;
  /** base64 bit array */
  b64: string;
}

// ≈0.8% fpr with k=7 — enough for a SINGLE-value probe. A batch probe of n
// ids prunes only at (1-fpr)^n, so callers testing large id sets must raise
// this (24 bits ≈ 1e-5 fpr keeps a 500-id batch pruning at ~99.5%).
export const BLOOM_DEFAULT_BITS_PER_ELEMENT = 10;
const BLOOM_HASHES = 7;
const BLOOM_MIN_BITS = 64;

const fnv1a = (value: string, seed: number): number => {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

/** double hashing; the step must be odd so every bit stays reachable */
const bloomBitPositions = (value: string, m: number, k: number): number[] => {
  const h1 = fnv1a(value, 0);
  // `| 1` alone coerces to a SIGNED int32 (negative for hashes ≥ 2^31), making
  // the modulo negative and the bit write a silent no-op — a false-negative factory
  const h2 = (fnv1a(value, 0x9e3779b9) | 1) >>> 0;
  const positions: number[] = [];
  for (let i = 0; i < k; i++) {
    positions.push((h1 + i * h2) % m);
  }
  return positions;
};

export const buildRecordBloom = (
  recordIds: Iterable<string>,
  count: number,
  bitsPerElement = BLOOM_DEFAULT_BITS_PER_ELEMENT
): IRecordBloom => {
  const m = Math.max(BLOOM_MIN_BITS, Math.ceil(count * bitsPerElement));
  const bytes = Buffer.alloc(Math.ceil(m / 8));
  for (const recordId of recordIds) {
    for (const position of bloomBitPositions(recordId, m, BLOOM_HASHES)) {
      bytes[position >> 3] |= 1 << (position & 7);
    }
  }
  return { m, k: BLOOM_HASHES, b64: bytes.toString('base64') };
};

const testBits = (bytes: Buffer, bloom: IRecordBloom, recordId: string): boolean => {
  for (const position of bloomBitPositions(recordId, bloom.m, bloom.k)) {
    if ((bytes[position >> 3] & (1 << (position & 7))) === 0) return false;
  }
  return true;
};

/** false only when the record is DEFINITELY absent — safe to prune on false */
export const bloomMightContain = (bloom: IRecordBloom, recordId: string): boolean =>
  testBits(Buffer.from(bloom.b64, 'base64'), bloom, recordId);

/**
 * Same pruning test over many ids at once. Decodes the bit array ONCE — the
 * per-id form would re-decode the whole base64 payload for every candidate,
 * and the pruning-succeeds case (the common one) tests every id.
 */
export const bloomMightContainAny = (bloom: IRecordBloom, recordIds: Iterable<string>): boolean => {
  const bytes = Buffer.from(bloom.b64, 'base64');
  for (const recordId of recordIds) {
    if (testBits(bytes, bloom, recordId)) return true;
  }
  return false;
};
