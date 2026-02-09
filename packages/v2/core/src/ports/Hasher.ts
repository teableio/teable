/**
 * IHasher port for computing hash values.
 *
 * Different environments can provide different implementations:
 * - Node.js: use crypto.createHash
 * - Browser: use Web Crypto API or a pure JS implementation
 */
export interface IHasher {
  /**
   * Computes a SHA-256 hash of the input string.
   * @param input - The string to hash
   * @returns The hex-encoded hash string
   */
  sha256(input: string): string;
}
