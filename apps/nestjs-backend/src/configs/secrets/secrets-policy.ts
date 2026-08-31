import type { ISecretSpec } from './secret-specs';
import { ALL_SECRET_SPECS } from './secret-specs';

type IEnv = Record<string, string | undefined>;

const isConfigured = (spec: ISecretSpec, env: IEnv): boolean =>
  [spec.envKey, ...(spec.fallbackEnvKeys ?? [])].some((key) => {
    const value = env[key];
    return typeof value === 'string' && value !== '';
  });

/** Required specs (per requiredWhen) whose dedicated/fallback env vars are all unset. */
export const findMissingSecrets = (
  specs: readonly ISecretSpec[],
  env: IEnv = process.env
): ISecretSpec[] =>
  specs.filter((spec) => (spec.requiredWhen?.(env) ?? true) && !isConfigured(spec, env));

/** Specs still running on their publicly known former source default. */
export const findPublicDefaultSecrets = (
  specs: readonly ISecretSpec[],
  env: IEnv = process.env
): ISecretSpec[] =>
  specs.filter(
    (spec) => spec.legacyDefault !== undefined && env[spec.envKey] === spec.legacyDefault
  );

// aes-128-cbc slots need exactly 16 chars; everything else takes any strong value.
const isAes16Slot = (envKey: string) => /_ENCRYPTION_(?:KEY|IV)$/.test(envKey);

export const buildMissingSecretsMessage = (missing: ISecretSpec[]): string => {
  const list = missing
    .map(
      (s) =>
        `  - ${s.fallbackEnvKeys?.length ? `${s.envKey} (or ${s.fallbackEnvKeys.join(' / ')})` : s.envKey}: ${s.usedFor}`
    )
    .join('\n');
  // Directly copy-pastable blocks — never send the operator off to another file.
  const existingBlock = missing
    .map((s) =>
      s.legacyDefault !== undefined && s.pinInstruction === undefined
        ? `    ${s.envKey}='${s.legacyDefault}'`
        : `    # ${s.envKey} — ${s.pinInstruction}`
    )
    .join('\n');
  const newBlock = missing
    .map(
      (s) => `    ${s.envKey}=$(openssl rand ${isAes16Slot(s.envKey) ? '-hex 8' : '-base64 32'})`
    )
    .join('\n');
  return [
    'SECURITY WARNING: missing secret environment variable(s) — the instance will START anyway, falling back to the built-in PUBLICLY KNOWN defaults (they live in the public git history, so anyone can forge tokens / decrypt data protected by them):',
    '',
    list,
    '',
    'Fine for a quick local try-out; for anything reachable from the network, set your own values.',
    '',
    'EXISTING deployment (was running without these variables): it is implicitly using the old built-in values. To pin them explicitly before rotating, add EXACTLY the block below (mind `$` escaping in your env format):',
    '',
    existingBlock,
    '',
    'NEW deployment: generate fresh values instead:',
    '',
    newBlock,
    '',
    'Planned JWT secret rotation later on: put the new value in BACKEND_JWT_SECRET and keep the previous one in BACKEND_JWT_SECRET_OLD until outstanding tokens expire (~30d), then remove it.',
    '',
    'Planned encryption key rotation: move the current pair into <VAR>_OLD (e.g. BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY_OLD / ..._IV_OLD — ALWAYS both, copying the unchanged half; half a pair refuses to boot), put fresh values in the main vars, and keep _OLD until no ciphertext under it remains (access tokens live until they expire or are revoked). If the old key LEAKED, do NOT pin it into _OLD — hard-cut instead: _OLD is accepted for decryption, so pinning a leaked key keeps forged ciphertext working.',
  ].join('\n');
};

export const buildPublicDefaultsWarning = (onDefaults: ISecretSpec[]): string =>
  [
    'SECURITY WARNING: the following secrets are set to their PUBLICLY KNOWN former source-code defaults (they live in the public git history, so anyone can forge tokens / decrypt data protected by them):',
    '',
    ...onDefaults.map((s) => `  - ${s.envKey} (${s.usedFor})`),
    '',
    'The instance keeps running so existing data stays accessible, but plan a rotation to freshly generated values as soon as possible.',
  ].join('\n');

/**
 * The single policy checkpoint for secret configuration. ConfigModule calls it
 * right after BaseConfigModule.forRoot() has synchronously loaded the env
 * files and BEFORE any config factory runs, so the aggregated teaching below
 * is the FIRST thing the operator sees.
 *
 * The policy never blocks boot — a first-time self-hoster must be able to
 * start with zero secret configuration (resolve-secret.ts falls back to the
 * legacy source-code defaults). It only warns, loudly:
 *
 * - missing secrets → loud error log with per-secret pin/generate
 *   instructions, then boot on the legacy defaults. Development sets no
 *   secrets BY DESIGN — it exercises the exact zero-config path self-hosters
 *   hit — so expect this warning on every local boot;
 * - secrets explicitly set to their public former defaults → loud error log,
 *   and boot (a deployment that pinned them per the instructions above).
 */
export const enforceSecretsPolicy = (
  env: Record<string, string | undefined> = process.env,
  // console.error on purpose: this runs before the Nest logger exists.
  logError: (message: string) => void = (message) => console.error(message)
): void => {
  const missing = findMissingSecrets(ALL_SECRET_SPECS, env);
  if (missing.length > 0) {
    logError(buildMissingSecretsMessage(missing));
  }
  const onDefaults = findPublicDefaultSecrets(ALL_SECRET_SPECS, env);
  if (onDefaults.length > 0) {
    logError(buildPublicDefaultsWarning(onDefaults));
  }
};
