import { describe, expect, it } from 'vitest';
import type { ICipherEntry } from './encryptor';
import { Encryptor } from './encryptor';

// The public legacy defaults of the access-token / storage sites — also the
// triples the golden vectors below were generated under.
const LEGACY_PAT: ICipherEntry = {
  algorithm: 'aes-128-cbc',
  key: 'ie21hOKjlXUiGDx9',
  iv: 'i0vKGXBWkzyAoGf4',
};
const LEGACY_STORAGE: ICipherEntry = {
  algorithm: 'aes-128-cbc',
  key: '73b00476e456323e',
  iv: '8c9183e4c175f63c',
};
const ROTATED: ICipherEntry = {
  algorithm: 'aes-128-cbc',
  key: '0123456789abcdef',
  iv: 'fedcba9876543210',
};

describe('Encryptor', () => {
  it('requires at least one cipher entry', () => {
    expect(() => new Encryptor({ entries: [] })).toThrow();
  });

  it('round-trips through a single entry', () => {
    const box = new Encryptor<{ sign: string }>({ entries: [LEGACY_PAT], encoding: 'base64' });
    expect(box.decrypt(box.encrypt({ sign: 'abc' }))).toEqual({ sign: 'abc' });
  });

  // Golden vectors generated with the pre-rotation single-triple
  // implementation — they pin the ciphertext format across the refactor.
  it('decrypts pre-rotation base64 ciphertext (golden vector)', () => {
    const box = new Encryptor<{ sign: string }>({ entries: [LEGACY_PAT], encoding: 'base64' });
    expect(box.decrypt('PHvnKFjPYeRzLsmdyAZ2yslRRuhxXTeoEDvlT009RXU=')).toEqual({
      sign: 'abc123',
    });
  });

  it('decrypts pre-rotation hex ciphertext (golden vector)', () => {
    const box = new Encryptor<{ expire: number }>({ entries: [LEGACY_STORAGE] });
    expect(box.decrypt('21917f60ead0bc47a3bd2e599ca04420')).toEqual({ expire: 123 });
  });

  it('encrypts with entries[0] only', () => {
    const rotated = new Encryptor<{ sign: string }>({
      entries: [ROTATED, LEGACY_PAT],
      encoding: 'base64',
    });
    const cipher = rotated.encrypt({ sign: 'xyz' });
    const newOnly = new Encryptor<{ sign: string }>({ entries: [ROTATED], encoding: 'base64' });
    expect(newOnly.decrypt(cipher)).toEqual({ sign: 'xyz' });
    const legacyOnly = new Encryptor<{ sign: string }>({
      entries: [LEGACY_PAT],
      encoding: 'base64',
    });
    expect(() => legacyOnly.decrypt(cipher)).toThrow('Decryption failed');
  });

  it('decrypts ciphertext of every tail entry after a rotation', () => {
    const legacy = new Encryptor<{ sign: string }>({ entries: [LEGACY_PAT], encoding: 'base64' });
    const oldCipher = legacy.encrypt({ sign: 'kept' });
    const rotated = new Encryptor<{ sign: string }>({
      entries: [ROTATED, LEGACY_PAT],
      encoding: 'base64',
    });
    expect(rotated.decrypt(oldCipher)).toEqual({ sign: 'kept' });
    expect(rotated.decrypt(rotated.encrypt({ sign: 'new' }))).toEqual({ sign: 'new' });
  });

  it('throws when no entry can open the ciphertext', () => {
    const box = new Encryptor<{ sign: string }>({ entries: [LEGACY_PAT], encoding: 'base64' });
    const foreign = new Encryptor<{ sign: string }>({ entries: [ROTATED], encoding: 'base64' });
    expect(() => box.decrypt(foreign.encrypt({ sign: 'x' }))).toThrow('Decryption failed');
    expect(() => box.decrypt('not-a-ciphertext')).toThrow('Decryption failed');
  });
});
