import { createHash } from 'node:crypto';
import type { IHasher } from '@teable/v2-core';

/**
 * Node.js crypto-based hasher implementation for CLI usage.
 */
export class NodeCryptoHasher implements IHasher {
  sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }
}
