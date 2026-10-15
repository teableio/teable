import { describe, expect, it } from 'vitest';
import { getCookieSecure, normalizePemPrivateKey, parseAppleClient } from './auth.config';

const PEM = '-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEG\n-----END PRIVATE KEY-----';

describe('getCookieSecure', () => {
  it('turns Secure on for an https deployment by default', () => {
    expect(getCookieSecure(undefined, 'https://workspace.example.com')).toBe(true);
  });

  it('keeps plain-http development working without the attribute', () => {
    expect(getCookieSecure(undefined, 'http://localhost:3000')).toBeUndefined();
    expect(getCookieSecure(undefined, undefined)).toBeUndefined();
  });

  it('honours an explicit override, including auto', () => {
    expect(getCookieSecure('false', 'https://workspace.example.com')).toBe(false);
    expect(getCookieSecure('true', 'http://localhost:3000')).toBe(true);
    expect(getCookieSecure('auto', 'https://workspace.example.com')).toBe('auto');
  });
});

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
