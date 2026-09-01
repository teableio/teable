import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import type { IAuthConfig } from '../../../configs/auth.config';
import { TeableJwtService } from './teable-jwt.service';

const makeService = (secret: string, oldSecret?: string) =>
  new TeableJwtService({ jwt: { secret, oldSecret, expiresIn: '1h' } } as IAuthConfig);

describe('TeableJwtService', () => {
  it('signs with the primary secret', async () => {
    const service = makeService('primary', 'old');
    const token = await service.signAsync({ a: 1 }, { expiresIn: '1h' });
    await expect(new JwtService({ secret: 'primary' }).verifyAsync(token)).resolves.toMatchObject({
      a: 1,
    });
    await expect(new JwtService({ secret: 'old' }).verifyAsync(token)).rejects.toThrow();
  });

  it('applies the configured default expiry when the sign site passes none', async () => {
    const service = makeService('primary');
    const token = await service.signAsync({ sub: 'x' });
    const payload = await service.verifyAsync<{ exp: number; iat: number }>(token);
    expect(payload.exp - payload.iat).toBe(3600);
  });

  it('does not inject the default expiry when the payload carries an absolute exp', async () => {
    // The ai-proxy api-key JWT sets exp directly from the DB row; jsonwebtoken
    // rejects expiresIn when the payload already has exp.
    const service = makeService('primary');
    const exp = Math.floor(Date.now() / 1000) + 999;
    const token = await service.signAsync({ sub: 'x', exp }, { noTimestamp: true });
    const payload = await service.verifyAsync<{ exp: number }>(token);
    expect(payload.exp).toBe(exp);
  });

  it('verifies tokens signed with any listed secret', async () => {
    const service = makeService('primary', 'old');
    const oldToken = await new JwtService({ secret: 'old' }).signAsync(
      { b: 2 },
      { expiresIn: '1h' }
    );
    await expect(service.verifyAsync(oldToken)).resolves.toMatchObject({ b: 2 });
  });

  it('rejects tokens signed with an unlisted secret', async () => {
    const service = makeService('primary', 'old');
    const foreign = await new JwtService({ secret: 'leaked' }).signAsync({ c: 3 });
    await expect(service.verifyAsync(foreign)).rejects.toThrow();
  });

  it('stops accepting old-secret tokens once oldSecret is dropped (hard cut)', async () => {
    const withOld = makeService('primary', 'old');
    const oldToken = await new JwtService({ secret: 'old' }).signAsync(
      { d: 4 },
      { expiresIn: '1h' }
    );
    await expect(withOld.verifyAsync(oldToken)).resolves.toBeDefined();
    const hardCut = makeService('primary');
    await expect(hardCut.verifyAsync(oldToken)).rejects.toThrow();
  });

  it('surfaces expiry of a primary-signed token instead of retrying older secrets', async () => {
    const service = makeService('primary', 'old');
    const expired = await new JwtService({ secret: 'primary' }).signAsync(
      { e: 5 },
      { expiresIn: '-1s' }
    );
    await expect(service.verifyAsync(expired)).rejects.toBeInstanceOf(TokenExpiredError);
  });

  it('classifySigningSecret attributes tokens to their signing secret, ignoring expiry', async () => {
    const service = makeService('primary', 'old');
    const current = await service.signAsync({ a: 1 });
    const oldToken = await new JwtService({ secret: 'old' }).signAsync({ b: 2 });
    // An EXPIRED old-secret token must still classify as 'old' — rotation
    // tooling needs signature attribution, not validity.
    const expiredOld = await new JwtService({ secret: 'old' }).signAsync(
      { c: 3 },
      { expiresIn: '-1s' }
    );
    const foreign = await new JwtService({ secret: 'leaked' }).signAsync({ d: 4 });
    await expect(service.classifySigningSecret(current)).resolves.toBe('current');
    await expect(service.classifySigningSecret(oldToken)).resolves.toBe('old');
    await expect(service.classifySigningSecret(expiredOld)).resolves.toBe('old');
    await expect(service.classifySigningSecret(foreign)).resolves.toBe('none');
  });

  it('passportSecretProvider hands back whichever secret verifies', async () => {
    const service = makeService('primary', 'old');
    const oldToken = await new JwtService({ secret: 'old' }).signAsync(
      { f: 6 },
      { expiresIn: '1h' }
    );
    const provider = service.passportSecretProvider();
    const secret = await new Promise((resolve, reject) =>
      provider(null, oldToken, (err, s) => (err ? reject(err) : resolve(s)))
    );
    expect(secret).toBe('old');
  });

  it('passportSecretProvider attributes an EXPIRED old-secret token to the old secret', async () => {
    // Attribution ignores expiry: passport re-verifies with the returned
    // secret, so the client sees "jwt expired" instead of "invalid signature".
    const service = makeService('primary', 'old');
    const expiredOld = await new JwtService({ secret: 'old' }).signAsync(
      { h: 8 },
      { expiresIn: '-1s' }
    );
    const provider = service.passportSecretProvider();
    const secret = await new Promise((resolve, reject) =>
      provider(null, expiredOld, (err, s) => (err ? reject(err) : resolve(s)))
    );
    expect(secret).toBe('old');
  });

  it('passportSecretProvider falls back to the primary for unverifiable tokens', async () => {
    const service = makeService('primary', 'old');
    const foreign = await new JwtService({ secret: 'leaked' }).signAsync({ g: 7 });
    const provider = service.passportSecretProvider();
    const secret = await new Promise((resolve, reject) =>
      provider(null, foreign, (err, s) => (err ? reject(err) : resolve(s)))
    );
    expect(secret).toBe('primary');
  });
});
