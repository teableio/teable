import type { ISecretSpec } from './secret-specs';
import { ALL_SECRET_SPECS, SECRET_SPECS } from './secret-specs';

type IEnv = Record<string, string | undefined>;

const isSet = (env: IEnv, key: string): boolean => {
  const value = env[key];
  return typeof value === 'string' && value !== '';
};

const isConfigured = (spec: ISecretSpec, env: IEnv): boolean =>
  [spec.envKey, ...(spec.fallbackEnvKeys ?? [])].some((key) => isSet(env, key)) ||
  Boolean(spec.derivePurpose && isSet(env, 'SECRET_KEY'));

/** The vars besides the dedicated one that would satisfy the spec. */
const alternativeEnvKeys = (spec: ISecretSpec): string[] => [
  ...(spec.fallbackEnvKeys ?? []),
  ...(spec.derivePurpose ? ['SECRET_KEY'] : []),
];

/** Each key/iv pair is set together or left unset together. */
const CIPHER_PAIRS: [ISecretSpec, ISecretSpec][] = [
  [SECRET_SPECS.mailEncryptionKey, SECRET_SPECS.mailEncryptionIv],
  [SECRET_SPECS.storageEncryptionKey, SECRET_SPECS.storageEncryptionIv],
  [SECRET_SPECS.accessTokenEncryptionKey, SECRET_SPECS.accessTokenEncryptionIv],
  [SECRET_SPECS.dataDbUrlEncryptionKey, SECRET_SPECS.dataDbUrlEncryptionIv],
];

/** Pairs with exactly one half set. */
export const findHalfConfiguredPairs = (
  env: IEnv = process.env
): { set: ISecretSpec; unset: ISecretSpec }[] =>
  CIPHER_PAIRS.filter(([key, iv]) => isSet(env, key.envKey) !== isSet(env, iv.envKey)).map(
    ([key, iv]) => (isSet(env, key.envKey) ? { set: key, unset: iv } : { set: iv, unset: key })
  );

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

/**
 * SECRET_ADMIN_TOOLS_ENABLED holds back the admin-facing secret tooling until
 * it is opened: the server-secrets check of the admin checklist and, on
 * self-hosted, the JWT credentials and cipher re-encrypt pages. Off by
 * default. The boot warnings and the half-pair refusal do not depend on it.
 */
export const isSecretAdminToolsEnabled = (env: IEnv = process.env): boolean =>
  env.SECRET_ADMIN_TOOLS_ENABLED === 'true';

export type IInsecureSecretReason = 'missing' | 'publicDefault';

/**
 * The secrets this deployment actually reads (requiredWhen scopes them by
 * edition and storage provider) that are unset or pinned to their public
 * former default. Env var names only, never values — it feeds the instance
 * admin checklist. While SECRET_KEY is unset, the unset secrets that setting
 * it would cover are left out, so the checklist asks for that one variable
 * (the boot warning still lists each, with its pin value).
 */
export const findInsecureSecrets = (
  env: IEnv = process.env
): { envKey: string; reason: IInsecureSecretReason }[] => {
  const inScope = ALL_SECRET_SPECS.filter((spec) => spec.requiredWhen?.(env) ?? true);
  const rootEnvKey = SECRET_SPECS.secretKey.envKey;
  const missing = findMissingSecrets(inScope, env);
  const withRoot = { ...env, [rootEnvKey]: 'set' };
  const listed = missing.some((spec) => spec.envKey === rootEnvKey)
    ? missing.filter((spec) => spec.envKey === rootEnvKey || !isConfigured(spec, withRoot))
    : missing;
  return [
    ...listed.map((spec) => ({
      envKey: spec.envKey,
      reason: 'missing' as const,
    })),
    ...findPublicDefaultSecrets(inScope, env).map((spec) => ({
      envKey: spec.envKey,
      reason: 'publicDefault' as const,
    })),
  ];
};

// aes-128-cbc slots need exactly 16 chars; everything else takes any strong value.
const isAes16Slot = (envKey: string) => /_ENCRYPTION_(?:KEY|IV)$/.test(envKey);

/** The env line that pins an unset secret to the value it has been running on. */
const pinLine = (s: ISecretSpec): string =>
  s.legacyDefault !== undefined && s.pinInstruction === undefined
    ? `${s.envKey}='${s.legacyDefault}'`
    : `# ${s.envKey} — ${s.pinInstruction}`;

export const buildMissingSecretsMessage = (missing: ISecretSpec[]): string => {
  const list = missing
    .map((s) => {
      const alternatives = alternativeEnvKeys(s);
      return `  - ${alternatives.length ? `${s.envKey} (or ${alternatives.join(' / ')})` : s.envKey}: ${s.usedFor}`;
    })
    .join('\n');
  // Directly copy-pastable blocks — never send the operator off to another file.
  const existingBlock = missing.map((s) => `    ${pinLine(s)}`).join('\n');
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

/**
 * The pin line for the missing half of a pair. With SECRET_KEY set, an unset
 * half that derives from it has been running on the derived value, unless the
 * previous release predates the derivation and still used the legacy literal.
 * Boot cannot tell which, so name both, the derived one as a computation:
 * derived key material never goes to the log.
 */
const halfPairPinLine = (s: ISecretSpec, env: IEnv): string =>
  s.derivePurpose && s.legacyDefault !== undefined && isSet(env, 'SECRET_KEY')
    ? `# ${s.envKey} — derived from SECRET_KEY: compute \`node -e "console.log(require('crypto').createHash('sha256').update(process.env.SECRET_KEY + ':teable:${s.derivePurpose}').digest('hex').slice(0,16))"\`. If this instance was upgraded straight from a release that did not derive it yet, use '${s.legacyDefault}' instead.`
    : pinLine(s);

export const buildHalfConfiguredPairsMessage = (
  pairs: { set: ISecretSpec; unset: ISecretSpec }[],
  env: IEnv = process.env
): string =>
  [
    'Refusing to start: half of a key/iv pair is set. Each pair is used together, so set the missing half:',
    '',
    ...pairs.map(({ set, unset }) => `  - ${set.envKey} is set, ${unset.envKey} is not`),
    '',
    'To keep what was encrypted so far readable, give the missing half the value it has been running on:',
    '',
    ...pairs.map(({ unset }) => `    ${halfPairPinLine(unset, env)}`),
  ].join('\n');

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
 * right after BaseConfigModule.forRoot() has loaded the env files (awaited,
 * since @nestjs/config 12 validates asynchronously) and BEFORE any config
 * factory runs, so the aggregated teaching below is the FIRST thing the
 * operator sees.
 *
 * A missing secret never blocks boot — a first-time self-hoster must be able
 * to start with zero secret configuration (resolve-secret.ts falls back to
 * the legacy source-code defaults). It warns, loudly:
 *
 * - missing secrets → loud error log with per-secret pin/generate
 *   instructions, then boot on the legacy defaults. Development sets no
 *   secrets BY DESIGN — it exercises the exact zero-config path self-hosters
 *   hit — so expect this warning on every local boot;
 * - secrets explicitly set to their public former defaults → loud error log,
 *   and boot (a deployment that pinned them per the instructions above).
 *
 * The one refusal is half of a key/iv pair: its halves would resolve from
 * different sources and strand what was encrypted before, so boot stops and
 * names the value to pin.
 */
export const enforceSecretsPolicy = (
  env: Record<string, string | undefined> = process.env,
  // console.error on purpose: this runs before the Nest logger exists.
  logError: (message: string) => void = (message) => console.error(message)
): void => {
  const halfConfigured = findHalfConfiguredPairs(env);
  if (halfConfigured.length > 0) {
    throw new Error(buildHalfConfiguredPairsMessage(halfConfigured, env));
  }
  const missing = findMissingSecrets(ALL_SECRET_SPECS, env);
  if (missing.length > 0) {
    logError(buildMissingSecretsMessage(missing));
  }
  const onDefaults = findPublicDefaultSecrets(ALL_SECRET_SPECS, env);
  if (onDefaults.length > 0) {
    logError(buildPublicDefaultsWarning(onDefaults));
  }
};
