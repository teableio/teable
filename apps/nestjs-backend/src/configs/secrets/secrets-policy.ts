import { createHash } from 'node:crypto';
import type { ISecretSpec } from './secret-specs';
import { ALL_SECRET_SPECS, SECRET_SPECS } from './secret-specs';
import { PUBLIC_DEFAULT_STORED_ROOT } from './stored-secret-roots';

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

/**
 * Whether SECRET_KEY alone gives the spec a value, because it falls back to it
 * or is derived from it. Such a secret needs no variable of its own.
 */
const followsSecretKey = (spec: ISecretSpec): boolean =>
  spec.envKey !== SECRET_SPECS.secretKey.envKey && alternativeEnvKeys(spec).includes('SECRET_KEY');

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

/**
 * The stored credential root and the specs it superseded all end at SECRET_KEY: whenever one
 * of them resolves to nothing private, SECRET_KEY is unset too, and its own line says what
 * to set. None of them is listed, so no optional or deprecated var is taught.
 */
const resolvesThroughSecretKey = (spec: ISecretSpec): boolean => {
  const storedRoot: ISecretSpec = SECRET_SPECS.storedCredentialEncryptionSecret;
  return (
    spec === storedRoot ||
    (Boolean(spec.deprecated) && (spec.fallbackEnvKeys ?? []).includes(storedRoot.envKey))
  );
};

const isRequiredAndUnset = (spec: ISecretSpec, env: IEnv): boolean =>
  (spec.requiredWhen?.(env) ?? true) && !isConfigured(spec, env);

/**
 * Required specs (per requiredWhen) whose dedicated/fallback env vars are all unset, minus
 * the ones that resolve through SECRET_KEY by way of the stored credential root.
 */
export const findMissingSecrets = (
  specs: readonly ISecretSpec[],
  env: IEnv = process.env
): ISecretSpec[] =>
  specs.filter((spec) => isRequiredAndUnset(spec, env) && !resolvesThroughSecretKey(spec));

/**
 * The publicly known value a spec can be pinned to: its former source default, or for the
 * stored credential root, which has none of its own, the one SECRET_KEY falls back to.
 */
const publicDefaultOf = (spec: ISecretSpec): string | undefined =>
  spec.legacyDefault ??
  (spec.envKey === SECRET_SPECS.storedCredentialEncryptionSecret.envKey
    ? PUBLIC_DEFAULT_STORED_ROOT
    : undefined);

/** Specs explicitly set to a publicly known value. */
export const findPublicDefaultSecrets = (
  specs: readonly ISecretSpec[],
  env: IEnv = process.env
): ISecretSpec[] =>
  specs.filter((spec) => {
    const publicDefault = publicDefaultOf(spec);
    return publicDefault !== undefined && env[spec.envKey] === publicDefault;
  });

export type IInsecureSecretReason = 'missing' | 'publicDefault';

/**
 * The secrets this deployment actually reads (requiredWhen scopes them by
 * edition and storage provider) that are unset or pinned to their public
 * former default. Env var names only, never values — it feeds the instance
 * admin checklist. While SECRET_KEY is unset, the unset secrets that setting
 * it would cover are left out, so the checklist asks for that one variable
 * (the boot warning still lists each).
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

/**
 * Announced one version ahead, and only where it will apply: a later version refuses to
 * start in production mode while SECRET_KEY is unset or on its public default, so a
 * production boot that still starts that way says so. Development and tests keep running
 * without one and are not told.
 */
const SECRET_KEY_REQUIRED_NOTICE =
  'A LATER VERSION WILL REFUSE TO START while SECRET_KEY is unset or set to its publicly known default. Set a private SECRET_KEY before upgrading to it.';

const isSecretKey = (spec: ISecretSpec): boolean => spec.envKey === SECRET_SPECS.secretKey.envKey;

const announcesStartupRefusal = (specs: ISecretSpec[], env: IEnv): boolean =>
  env.NODE_ENV === 'production' && specs.some(isSecretKey);

// aes-128-cbc slots need exactly 16 chars; everything else takes any strong value.
const isAes16Slot = (envKey: string) => /_ENCRYPTION_(?:KEY|IV)$/.test(envKey);

/** The env line that pins the unset half of a key/iv pair to the value it has been running on. */
const pinLine = (s: ISecretSpec): string =>
  s.legacyDefault !== undefined && s.pinInstruction === undefined
    ? `${s.envKey}='${s.legacyDefault}'`
    : `# ${s.envKey} — ${s.pinInstruction}`;

const isUnset = (missing: ISecretSpec[], spec: ISecretSpec): boolean =>
  missing.some((s) => s.envKey === spec.envKey);

/** The _OLD lines that keep an existing deployment's data readable, each under what it keeps. */
const keptReadableLines = (missing: ISecretSpec[]): string[] => {
  const lines: string[] = [];
  let lastNote: string | undefined;
  for (const { keepReadable } of missing) {
    if (!keepReadable) continue;
    if (keepReadable.note !== lastNote) lines.push(`    # ${keepReadable.note}`);
    lines.push(`    ${keepReadable.line}`);
    lastNote = keepReadable.note;
  }
  return lines;
};

/**
 * A stored credential root of its own means nothing was stored under SECRET_KEY, so a change of
 * SECRET_KEY strands nothing there: no _OLD line for it. That line would also overwrite the
 * previous root a deployment rotating the stored credential root keeps in the same variable.
 */
const withoutCoveredRoot = (specs: ISecretSpec[], env: IEnv): ISecretSpec[] =>
  isSet(env, SECRET_SPECS.storedCredentialEncryptionSecret.envKey)
    ? specs.filter((spec) => !isSecretKey(spec))
    : specs;

/**
 * What changes once a private SECRET_KEY takes over from a public value, by which secrets ran
 * on that value. The old signing values are public, so nothing keeps them accepted; the
 * access-token and mail pairs keep theirs for decryption.
 */
const switchEffects = (onOldValue: (spec: ISecretSpec) => boolean): string[] => {
  const keptByCode = [
    ...(onOldValue(SECRET_SPECS.accessTokenEncryptionKey) ? ['personal access tokens'] : []),
    ...(onOldValue(SECRET_SPECS.mailEncryptionKey) ? ['email unsubscribe links'] : []),
  ];
  return [
    ...(onOldValue(SECRET_SPECS.sessionSecret) ? ['everyone signs in again'] : []),
    ...(onOldValue(SECRET_SPECS.jwtSecret)
      ? [
          'share-link sessions, plugin and OAuth tokens and App Builder app credentials signed so far stop being accepted (refresh app credentials in System Admin → Key rotation → JWT credentials, or on each app)',
        ]
      : []),
    ...(keptByCode.length > 0
      ? [
          `${keptByCode.join(' and ')} issued so far keep working, their old key staying accepted for decryption only`,
        ]
      : []),
  ];
};

const switchSentence = (effects: string[]): string =>
  effects.length > 0 ? `At the switch: ${effects.join('; ')}.` : '';

const OLD_LINES_CLEANUP =
  'Afterwards re-encrypt in System Admin → Key rotation and remove an _OLD line once nothing is left under it; an instance without that page keeps them.';

/**
 * For a deployment that already has data. It is not told to set the built-in values as
 * variables of their own: they are public, and what follows SECRET_KEY needs no variable.
 * It switches to a private SECRET_KEY like a new deployment and adds the _OLD lines that
 * keep what it stored or sent readable.
 */
const existingDeploymentPart = (missing: ISecretSpec[], env: IEnv): string[] => {
  const kept = keptReadableLines(withoutCoveredRoot(missing, env));
  const atTheSwitch = switchSentence(switchEffects((spec) => isUnset(missing, spec)));
  const lead =
    'EXISTING deployment (it has been running on the built-in values): do NOT set those old values as variables of their own. They are public, and the dedicated variables are on their way out.';
  if (kept.length === 0) return atTheSwitch ? [`${lead} ${atTheSwitch}`, ''] : [];
  return [
    `${lead} Next to the new values above, add the lines below. They only decrypt or verify, so what was stored or sent so far stays readable:`,
    '',
    ...kept,
    '',
    [atTheSwitch, OLD_LINES_CLEANUP].filter(Boolean).join(' '),
    '',
  ];
};

export const buildMissingSecretsMessage = (
  missing: ISecretSpec[],
  env: IEnv = process.env
): string => {
  const list = missing
    .map((s) => {
      const alternatives = alternativeEnvKeys(s);
      return `  - ${alternatives.length ? `${s.envKey} (or ${alternatives.join(' / ')})` : s.envKey}: ${s.usedFor}`;
    })
    .join('\n');
  // Directly copy-pastable blocks — never send the operator off to another file.
  // A deployment sets SECRET_KEY and what does not follow it, nothing else: the rest falls
  // back to SECRET_KEY or is derived from it, and a variable it never set is one it never
  // has to retire. A deprecated secret is not one to start with either.
  const toGenerate = missing.filter((s) => !followsSecretKey(s) && !s.deprecated);
  const generateBlock = toGenerate
    .map(
      (s) => `    ${s.envKey}=$(openssl rand ${isAes16Slot(s.envKey) ? '-hex 8' : '-base64 32'})`
    )
    .join('\n');
  const whatToSet = toGenerate.length
    ? [
        'Set these, each to a freshly generated value:',
        '',
        generateBlock,
        '',
        ...(missing.some(followsSecretKey)
          ? [
              'That is all a deployment sets. The other variables above fall back to SECRET_KEY or are derived from it: leave them unset.',
              '',
            ]
          : []),
      ]
    : [];
  return [
    'SECURITY WARNING: missing secret environment variable(s) — the instance will START anyway, falling back to the built-in PUBLICLY KNOWN defaults (they live in the public git history, so anyone can forge tokens / decrypt data protected by them):',
    '',
    list,
    '',
    'Fine for a quick local try-out; for anything reachable from the network, set your own values.',
    '',
    ...(announcesStartupRefusal(missing, env) ? [SECRET_KEY_REQUIRED_NOTICE, ''] : []),
    ...whatToSet,
    ...existingDeploymentPart(missing, env),
    'Changing a secret later on: keep the previous value in the matching _OLD variable (BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET_OLD, BACKEND_JWT_SECRET_OLD, BACKEND_SESSION_SECRET_OLD, …) until nothing depends on it. A value that is public or LEAKED does not go into BACKEND_JWT_SECRET_OLD or BACKEND_SESSION_SECRET_OLD: it would stay accepted there, so forged tokens and sessions would keep working.',
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

/**
 * The legacy BYODB key and iv of a deployment whose SECRET_KEY is the public default and that
 * gave neither that pair nor the access-token pair a value: both halves are the same digest of
 * SECRET_KEY (data-db-url-secret.ts), as public as the default itself. The access-token and
 * mail pairs keep their public derivation on for decryption themselves; this one stays on only
 * through its _OLD variables, and the stored credential root's _OLD does not read it.
 */
const dataDbPairOnPublicSecretKey = (env: IEnv): string | undefined => {
  const hasOwnValue = [
    SECRET_SPECS.dataDbUrlEncryptionKey,
    SECRET_SPECS.dataDbUrlEncryptionIv,
    SECRET_SPECS.accessTokenEncryptionKey,
    SECRET_SPECS.accessTokenEncryptionIv,
  ].some((spec) => isSet(env, spec.envKey));
  if (hasOwnValue) return undefined;
  return createHash('sha256')
    .update(SECRET_SPECS.secretKey.legacyDefault)
    .digest('hex')
    .slice(0, 16);
};

/**
 * For a deployment that set SECRET_KEY to its public default and now replaces it: what the
 * missing-secrets message gives a deployment that never set it, with the legacy BYODB pair
 * being the one derived from that default. A secret with no variable of its own follows
 * SECRET_KEY, so it is on the old value.
 */
const replacingPublicSecretKeyPart = (env: IEnv): string[] => {
  const { secretKey, invitationSecret, dataDbUrlEncryptionKey, dataDbUrlEncryptionIv } =
    SECRET_SPECS;
  const dataDbPair = dataDbPairOnPublicSecretKey(env);
  const kept = [
    ...keptReadableLines(
      withoutCoveredRoot(
        [secretKey, ...(isSet(env, invitationSecret.envKey) ? [] : [invitationSecret])],
        env
      )
    ),
    ...(dataDbPair
      ? [
          `    # ${dataDbUrlEncryptionKey.keepReadable.note}`,
          `    ${dataDbUrlEncryptionKey.envKey}_OLD='${dataDbPair}'`,
          `    ${dataDbUrlEncryptionIv.envKey}_OLD='${dataDbPair}'`,
        ]
      : []),
  ];
  const followsSecretKeyHere = (spec: ISecretSpec): boolean =>
    (spec.requiredWhen?.(env) ?? true) && !isSet(env, spec.envKey);
  const atTheSwitch = switchSentence(switchEffects(followsSecretKeyHere));
  if (kept.length === 0) return atTheSwitch ? ['', `Replacing SECRET_KEY: ${atTheSwitch}`] : [];
  return [
    '',
    'Replacing SECRET_KEY: add these next to the new value. They only decrypt or verify, so what was stored or sent under the old one stays readable:',
    '',
    ...kept,
    '',
    [atTheSwitch, OLD_LINES_CLEANUP].filter(Boolean).join(' '),
  ];
};

export const buildPublicDefaultsWarning = (
  onDefaults: ISecretSpec[],
  env: IEnv = process.env
): string =>
  [
    'SECURITY WARNING: the following secrets are set to their PUBLICLY KNOWN former source-code defaults (they live in the public git history, so anyone can forge tokens / decrypt data protected by them):',
    '',
    ...onDefaults.map((s) => `  - ${s.envKey} (${s.usedFor})`),
    '',
    'The instance keeps running so existing data stays accessible, but plan a rotation to freshly generated values as soon as possible.',
    ...(onDefaults.some(isSecretKey) ? replacingPublicSecretKeyPart(env) : []),
    ...(announcesStartupRefusal(onDefaults, env) ? ['', SECRET_KEY_REQUIRED_NOTICE] : []),
  ].join('\n');

// The key/iv pairs whose ciphertext sits in users' hands, with the cipher each runs under.
const USER_HELD_PAIRS: { key: ISecretSpec; iv: ISecretSpec; algorithm: (env: IEnv) => string }[] = [
  {
    key: SECRET_SPECS.accessTokenEncryptionKey,
    iv: SECRET_SPECS.accessTokenEncryptionIv,
    algorithm: (env) => env.BACKEND_ACCESS_TOKEN_ENCRYPTION_ALGORITHM ?? 'aes-128-cbc',
  },
  {
    key: SECRET_SPECS.mailEncryptionKey,
    iv: SECRET_SPECS.mailEncryptionIv,
    algorithm: () => 'aes-128-cbc',
  },
];
/** The key length an AES-CBC cipher takes, from its name (aes-128-cbc: 16 bytes). */
const cbcKeyBytes = (algorithm: string): number | undefined => {
  const bits = /^aes-(128|192|256)-cbc$/.exec(algorithm)?.[1];
  return bits ? Number(bits) / 8 : undefined;
};
const CBC_IV_BYTES = 16;

/**
 * Access token and mail key/iv values (and their _OLD) their cipher can't take: nothing can be
 * sealed with them, so no token or unsubscribe link gets issued, and nothing sealed under them
 * opens. Env var names and the length each needs, never the values.
 */
export const findWrongLengthCipherValues = (
  env: IEnv = process.env
): { envKey: string; bytes: number }[] =>
  USER_HELD_PAIRS.flatMap(({ key, iv, algorithm }) => {
    const keyBytes = cbcKeyBytes(algorithm(env));
    if (!keyBytes) return [];
    return [
      { envKey: key.envKey, bytes: keyBytes },
      { envKey: iv.envKey, bytes: CBC_IV_BYTES },
      { envKey: `${key.envKey}_OLD`, bytes: keyBytes },
      { envKey: `${iv.envKey}_OLD`, bytes: CBC_IV_BYTES },
    ].filter(
      ({ envKey, bytes }) => isSet(env, envKey) && Buffer.byteLength(env[envKey]!) !== bytes
    );
  });

export const buildWrongLengthCipherValuesWarning = (
  wrong: { envKey: string; bytes: number }[]
): string =>
  [
    'WARNING: these key/iv values are not the length their cipher needs. Encrypting with them fails, so no personal access token or unsubscribe link can be issued, and nothing sealed under them opens:',
    '',
    ...wrong.map(({ envKey, bytes }) => `  - ${envKey} must be exactly ${bytes} bytes`),
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
 * - missing secrets → loud error log with the lines that generate SECRET_KEY and
 *   what does not follow it and, for a deployment that already has data, the _OLD
 *   lines that keep it readable, then boot on the legacy defaults. Development sets no
 *   secrets BY DESIGN — it exercises the exact zero-config path self-hosters
 *   hit — so expect this warning on every local boot;
 * - secrets explicitly set to their public former defaults → loud error log,
 *   and boot (a deployment that pinned them as earlier versions taught);
 * - access token or mail key/iv values of a length their cipher can't take →
 *   error log naming the variables and the length each needs, and boot.
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
    logError(buildMissingSecretsMessage(missing, env));
  }
  const onDefaults = findPublicDefaultSecrets(ALL_SECRET_SPECS, env);
  if (onDefaults.length > 0) {
    logError(buildPublicDefaultsWarning(onDefaults, env));
  }
  const wrongLength = findWrongLengthCipherValues(env);
  if (wrongLength.length > 0) {
    logError(buildWrongLengthCipherValuesWarning(wrongLength));
  }
};
