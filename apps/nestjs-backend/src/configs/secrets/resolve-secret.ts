import { createHash } from 'crypto';
import type { ISecretSpec } from './secret-specs';

/**
 * Per-purpose derivation from the root SECRET_KEY: every purpose yields a
 * distinct 16-char value, so sharing one root secret never shares key material
 * across subsystems.
 */
const deriveFromSecretKey = (purpose: string, secretKey: string): string =>
  createHash('sha256').update(`${secretKey}:teable:${purpose}`).digest('hex').slice(0, 16);

/**
 * Resolve a secret: dedicated env var → fallback env vars → legacy source-code
 * default → SECRET_KEY derivation. Config factories call this, which runs when
 * ConfigModule loads — BEFORE any module init. Policy (what production should
 * set, migration teaching, weak-value warnings) lives in secrets-policy.ts,
 * not here.
 *
 * The legacy default sits BEFORE the SECRET_KEY derivation on purpose: a
 * pre-hardening deployment that set SECRET_KEY but no dedicated vars had its
 * data encrypted under the old literal defaults — resolving to a derived value
 * instead would silently change its effective keys and strand that data.
 * Booting on a legacy default is allowed (enforceSecretsPolicy warns loudly);
 * the derivation branch remains only for specs without a legacy default.
 *
 * An empty-string env var counts as unset, like everywhere else in the policy
 * (isConfigured in secrets-policy.ts, deriveFromSecretKey above): compose
 * passthrough (`- SECRET_KEY=${SECRET_KEY}` with the host var unset) and blank
 * .env placeholder lines produce '', which no consumer can use anyway —
 * jsonwebtoken, express-session and aes-128-cbc all reject empty keys.
 */
export const resolveSecret = (
  spec: ISecretSpec,
  env: Record<string, string | undefined> = process.env
): string => {
  const resolved =
    [spec.envKey, ...(spec.fallbackEnvKeys ?? [])].map((key) => env[key]).find((value) => value) ??
    spec.legacyDefault ??
    (spec.derivePurpose && env.SECRET_KEY
      ? deriveFromSecretKey(spec.derivePurpose, env.SECRET_KEY)
      : undefined);
  if (!resolved) {
    const alternatives = [
      ...(spec.fallbackEnvKeys ?? []),
      ...(spec.derivePurpose ? ['SECRET_KEY'] : []),
    ];
    throw new Error(
      `Missing secret configuration: set ${spec.envKey}${alternatives.length ? ` (or ${[...new Set(alternatives)].join(' / ')})` : ''}`
    );
  }
  return resolved;
};
