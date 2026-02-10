import type { IHasher } from '../Hasher';

/**
 * A simple fallback hasher that uses a basic string hash algorithm.
 * This is NOT cryptographically secure and should only be used as a fallback
 * when no proper hasher is available.
 */
export class NoopHasher implements IHasher {
  sha256(input: string): string {
    // Simple djb2 hash - not cryptographically secure but works everywhere
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 33) ^ input.charCodeAt(i);
    }
    // Convert to unsigned 32-bit integer and then to hex
    const unsignedHash = hash >>> 0;
    return unsignedHash.toString(16).padStart(8, '0');
  }
}
