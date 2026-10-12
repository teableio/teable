import { describe, expect, it } from 'vitest';
import { normalizePemPrivateKey, parseAppleClient } from './auth.config';

const PEM = '-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEG\n-----END PRIVATE KEY-----';

describe('normalizePemPrivateKey', () => {
  it('passes a multi-line PEM through', () => {
    expect(normalizePemPrivateKey(`${PEM}\n`)).toBe(PEM);
  });

  it('unescapes the single-line "\\n" spelling env files use', () => {
    expect(normalizePemPrivateKey(PEM.replace(/\n/g, '\\n'))).toBe(PEM);
  });

  it('decodes a base64-encoded key file', () => {
    expect(normalizePemPrivateKey(Buffer.from(PEM).toString('base64'))).toBe(PEM);
  });

  it('leaves an unset key undefined', () => {
    expect(normalizePemPrivateKey(undefined)).toBeUndefined();
    expect(normalizePemPrivateKey('  ')).toBeUndefined();
  });
});

describe('parseAppleClient', () => {
  it('splits the Services ID, Team ID and Key ID triple', () => {
    expect(parseAppleClient('ai.teable.signin:ABCDE12345:FGHIJ67890')).toEqual({
      clientID: 'ai.teable.signin',
      teamID: 'ABCDE12345',
      keyID: 'FGHIJ67890',
    });
  });

  it('leaves missing parts undefined instead of empty strings', () => {
    expect(parseAppleClient(undefined)).toEqual({
      clientID: undefined,
      teamID: undefined,
      keyID: undefined,
    });
    expect(parseAppleClient('ai.teable.signin')).toMatchObject({ teamID: undefined });
  });
});
