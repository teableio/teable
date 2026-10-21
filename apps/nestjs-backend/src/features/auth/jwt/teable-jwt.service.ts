import { Injectable } from '@nestjs/common';
import type { JwtSignOptions, JwtVerifyOptions } from '@nestjs/jwt';
import { JwtService, NotBeforeError, TokenExpiredError } from '@nestjs/jwt';
import { AuthConfig, IAuthConfig } from '../../../configs/auth.config';

/**
 * The single JWT facade for everything signed with the instance JWT secret,
 * with express-session-style secret-array semantics: index 0 signs every new
 * token, and a token verifies if ANY listed secret matches. A planned rotation
 * (new BACKEND_JWT_SECRET, previous value in BACKEND_JWT_SECRET_OLD) therefore
 * keeps outstanding tokens valid until they expire, across every consumer.
 *
 * Rotation discipline: this array is for PLANNED rotations only. A leaked
 * secret must be dropped from the list entirely (hard cut) — keeping it
 * verifiable would let the holder forge any token, including self-contained
 * payloads like email verification codes and temp tokens.
 *
 * Tokens expire after BACKEND_JWT_EXPIRES_IN by default; sign sites either
 * pass their own expiresIn or put an absolute `exp` claim in the payload
 * (jsonwebtoken rejects expiresIn when the payload already carries exp).
 */
@Injectable()
export class TeableJwtService {
  private readonly bare = new JwtService({});
  /** index 0 signs; every entry verifies */
  private readonly secrets: readonly string[];
  private readonly defaultExpiresIn: string;

  constructor(@AuthConfig() authConfig: IAuthConfig) {
    const { secret, oldSecret, expiresIn } = authConfig.jwt;
    this.secrets = oldSecret ? [secret, oldSecret] : [secret];
    this.defaultExpiresIn = expiresIn;
  }

  private signOptions(payload: Buffer | object, options?: JwtSignOptions): JwtSignOptions {
    const merged: JwtSignOptions = { ...options, secret: this.secrets[0] };
    if (merged.expiresIn === undefined && !(Buffer.isBuffer(payload) || 'exp' in payload)) {
      merged.expiresIn = this.defaultExpiresIn;
    }
    return merged;
  }

  sign(payload: Buffer | object, options?: JwtSignOptions): string {
    return this.bare.sign(payload, this.signOptions(payload, options));
  }

  signAsync(payload: Buffer | object, options?: JwtSignOptions): Promise<string> {
    return this.bare.signAsync(payload, this.signOptions(payload, options));
  }

  verify<T extends object>(token: string, options?: JwtVerifyOptions): T {
    let lastError: unknown;
    for (const secret of this.secrets) {
      try {
        return this.bare.verify<T>(token, { ...options, secret });
      } catch (error) {
        // Expired / not-before means the signature DID match this secret;
        // older secrets cannot make such a token valid — surface it as-is.
        if (error instanceof TokenExpiredError || error instanceof NotBeforeError) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError;
  }

  async verifyAsync<T extends object>(token: string, options?: JwtVerifyOptions): Promise<T> {
    let lastError: unknown;
    for (const secret of this.secrets) {
      try {
        return await this.bare.verifyAsync<T>(token, { ...options, secret });
      } catch (error) {
        // Same expiry short-circuit as verify() above.
        if (error instanceof TokenExpiredError || error instanceof NotBeforeError) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError;
  }

  /**
   * Which listed secret signed this token, ignoring expiry — rotation tooling
   * uses it to find stored long-lived credentials (e.g. App.accessToken) that
   * still depend on the previous secret and must be re-minted before
   * BACKEND_JWT_SECRET_OLD is removed.
   */
  async classifySigningSecret(token: string): Promise<'current' | 'old' | 'none'> {
    for (const [index, secret] of this.secrets.entries()) {
      try {
        await this.bare.verifyAsync(token, { secret, ignoreExpiration: true });
        return index === 0 ? 'current' : 'old';
      } catch {
        // try the next secret
      }
    }
    return 'none';
  }

  /**
   * passport-jwt secretOrKeyProvider with the same array semantics: attributes
   * the raw token to the listed secret that SIGNED it (ignoring expiry, like
   * classifySigningSecret), falling back to the primary for tokens no listed
   * secret signed. Validity is passport's job — it re-verifies fully with the
   * returned secret, so an expired old-secret token is reported as expired
   * instead of as a bad signature against the primary.
   */
  passportSecretProvider() {
    return (
      _req: unknown,
      rawJwtToken: string,
      done: (err: unknown, secretOrKey?: string) => void
    ): void => {
      void (async () => {
        for (const secret of this.secrets) {
          try {
            await this.bare.verifyAsync(rawJwtToken, { secret, ignoreExpiration: true });
            done(null, secret);
            return;
          } catch {
            // try the next secret
          }
        }
        done(null, this.secrets[0]);
      })();
    };
  }
}
