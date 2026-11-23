import { createHmac } from 'node:crypto';
import { decodeDataQueryCursor, encodeDataQueryCursor } from '@teable/v2-data-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseConfig } from './base.config';
import { ALL_SECRET_SPECS, SECRET_SPECS } from './secrets/secret-specs';

afterEach(() => vi.unstubAllEnvs());

describe('structured query cursor signing configuration', () => {
  beforeEach(() => {
    vi.stubEnv('SECRET_KEY', undefined);
    vi.stubEnv('BACKEND_JWT_SECRET', undefined);
    vi.stubEnv('BACKEND_SESSION_SECRET', undefined);
  });

  it.each([undefined, '', SECRET_SPECS.secretKey.legacyDefault])(
    'does not sign cursors with an unset or public root: %s',
    (root) => {
      vi.stubEnv('SECRET_KEY', root);
      expect(baseConfig().dataQueryCursorSigningKey).toBeUndefined();
    }
  );

  it.each([...new Set(ALL_SECRET_SPECS.map((spec) => spec.legacyDefault).filter(Boolean))])(
    'rejects public legacy values even when explicitly configured: %s',
    (publicDefault) => {
      vi.stubEnv('SECRET_KEY', publicDefault);
      vi.stubEnv('BACKEND_JWT_SECRET', publicDefault);
      vi.stubEnv('BACKEND_SESSION_SECRET', publicDefault);
      expect(baseConfig().dataQueryCursorSigningKey).toBeUndefined();
    }
  );

  it.each([
    ['BACKEND_JWT_SECRET', 'BACKEND_SESSION_SECRET'],
    ['BACKEND_SESSION_SECRET', 'BACKEND_JWT_SECRET'],
  ])('uses a private %s when the root and other auth secret are public or unset', (key, other) => {
    const privateSecret = 'private-host-auth-secret';
    const binding = 'authorized-host-query';
    const position = { values: ['12.5', null], id: 'recCursorContinuation' };
    vi.stubEnv(key, privateSecret);
    vi.stubEnv(other, SECRET_SPECS.secretKey.legacyDefault);
    const first = baseConfig().dataQueryCursorSigningKey;
    if (!first) throw new Error('A private host secret must configure cursor signing');
    expect(first).toHaveLength(64);
    expect(first).not.toBe(privateSecret);
    const token = encodeDataQueryCursor(binding, position, first)._unsafeUnwrap();
    expect(decodeDataQueryCursor(token, binding, privateSecret).isErr()).toBe(true);

    // A replica with the same secrets can resume even if the public root was pinned.
    vi.stubEnv('SECRET_KEY', SECRET_SPECS.secretKey.legacyDefault);
    const replica = baseConfig().dataQueryCursorSigningKey;
    if (!replica) throw new Error('The replica must configure cursor signing');
    expect(decodeDataQueryCursor(token, binding, replica)._unsafeUnwrap()).toEqual(position);

    vi.stubEnv(key, 'rotated-private-host-auth-secret');
    const rotated = baseConfig().dataQueryCursorSigningKey;
    if (!rotated) throw new Error('The rotated host secret must configure cursor signing');
    expect(decodeDataQueryCursor(token, binding, rotated).isErr()).toBe(true);
  });

  it('prefers the root, then JWT, then session so unrelated secret rotation keeps cursors valid', () => {
    vi.stubEnv('SECRET_KEY', 'private-host-root');
    vi.stubEnv('BACKEND_JWT_SECRET', 'private-host-jwt');
    vi.stubEnv('BACKEND_SESSION_SECRET', 'private-host-session');
    const rootKey = baseConfig().dataQueryCursorSigningKey;
    vi.stubEnv('BACKEND_JWT_SECRET', 'rotated-private-host-jwt');
    vi.stubEnv('BACKEND_SESSION_SECRET', 'rotated-private-host-session');
    expect(baseConfig().dataQueryCursorSigningKey).toBe(rootKey);

    vi.stubEnv('SECRET_KEY', undefined);
    const jwtKey = baseConfig().dataQueryCursorSigningKey;
    expect(jwtKey).toBeDefined();
    expect(jwtKey).not.toBe(rootKey);
    vi.stubEnv('BACKEND_SESSION_SECRET', 'again-rotated-private-host-session');
    expect(baseConfig().dataQueryCursorSigningKey).toBe(jwtKey);
  });

  it('derives the same purpose-separated full HMAC on every replica and changes it on rotation', () => {
    const root = 'explicit-test-deployment-root';
    vi.stubEnv('SECRET_KEY', root);
    const first = baseConfig().dataQueryCursorSigningKey;
    expect(first).toBe(
      createHmac('sha256', root).update('teable:data-query:cursor:v2').digest('hex')
    );
    expect(first).toHaveLength(64);
    expect(first).not.toBe(root);
    expect(first).not.toBe(
      createHmac('sha256', root).update('teable:official-plugin-secret').digest('hex')
    );
    expect(baseConfig().dataQueryCursorSigningKey).toBe(first);
    vi.stubEnv('SECRET_KEY', 'rotated-test-deployment-root');
    expect(baseConfig().dataQueryCursorSigningKey).not.toBe(first);
  });
});
