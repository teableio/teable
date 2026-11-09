import { createHmac, hkdfSync } from 'node:crypto';
import { HttpErrorCode } from '@teable/core';
import { MASKED_SECRET_PREFIX, isMaskedSecret } from '@teable/openapi';
import { resolveSecret } from '../../configs/secrets/resolve-secret';
import { SECRET_SPECS } from '../../configs/secrets/secret-specs';
import { CustomHttpException } from '../../custom.exception';

/**
 * Secret masking for configs a client reads and writes back (admin settings, space AI
 * integrations, SSO providers), driven by one declaration per config kind.
 *
 * APIs never return a stored secret: each one comes back as a mask that fingerprints it. A
 * mask written back resolves to the stored secret it stands for only while the endpoint that
 * secret is sent to is unchanged, so a client can round-trip a config without holding its
 * secrets, but can never point a kept secret at a server of its choosing: changing the
 * endpoint means entering the secret again. Saves, test calls and section patches all go
 * through the functions below.
 */

/** A field naming where a secret is sent, relative to its slot's anchor object. */
export interface ISecretEndpointField {
  path: readonly string[];
  /**
   * `strict`: any change counts. `orDefault`: left empty (the provider's official default
   * endpoint, which a caller cannot pick) also keeps the secret.
   */
  match: 'strict' | 'orDefault';
  /** What an absent field means (e.g. `false` for a flag), so leaving it out is no change. */
  unset?: unknown;
}

/** One kind of stored secret in a config. */
export interface ISecretSlot {
  /** The object the secret and its endpoint fields belong to; `*` walks every array element. */
  anchor?: readonly string[];
  /** The secret, relative to the anchor; `*` walks every array element. */
  secret: readonly string[];
  /** The fields naming where the secret goes. None: a fixed endpoint. */
  endpoint?: readonly ISecretEndpointField[];
  /**
   * Slots sharing a group go to the same endpoint and may trade secrets; without one a slot
   * only resolves masks of its own secrets.
   */
  group?: string;
}

type IRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is IRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

let maskKey: Buffer | undefined;

// Keyed, so a mask offers no offline guess at a weak secret such as an SMTP password, and
// derived from a configured root, so every pod computes the same mask.
const getMaskKey = (): Buffer =>
  (maskKey ??= Buffer.from(
    hkdfSync(
      'sha256',
      resolveSecret(SECRET_SPECS.thirdPartyCredentialEncryptionSecret),
      '',
      'teable:setting-secret-mask',
      32
    )
  ));

const maskSecret = (secret: string): string =>
  MASKED_SECRET_PREFIX +
  createHmac('sha256', getMaskKey()).update(secret).digest('base64url').slice(0, 22);

/** `node` with `fn` applied to each value `path` reaches; never mutates, copies what changes. */
const mapPath = (
  node: unknown,
  path: readonly string[],
  fn: (value: unknown, parent: unknown) => unknown,
  parent: unknown = undefined
): unknown => {
  if (path.length === 0) return fn(node, parent);
  const [key, ...rest] = path;
  if (key === '*') {
    if (!Array.isArray(node)) return node;
    const next = node.map((item) => mapPath(item, rest, fn, node));
    return next.some((item, i) => item !== node[i]) ? next : node;
  }
  if (!isRecord(node) || !(key in node)) return node;
  const child = node[key];
  const mapped = mapPath(child, rest, fn, node);
  return mapped === child ? node : { ...node, [key]: mapped };
};

const isSecretValue = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

const groupOf = (slot: ISecretSlot) =>
  slot.group ?? [...(slot.anchor ?? []), ...slot.secret].join('.');

const label = (slot: ISecretSlot) => [...(slot.anchor ?? []), ...slot.secret].join('.');

const fieldValue = (anchor: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), anchor);

const sameValue = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');

/** Whether a secret saved with `saved` endpoint values may go to `next`. */
const endpointKept = (
  fields: readonly ISecretEndpointField[] = [],
  saved: readonly unknown[],
  next: readonly unknown[]
) =>
  fields.every(({ match }, i) =>
    match === 'orDefault' && !next[i] ? true : sameValue(saved[i], next[i])
  );

/** Each anchor object of `slot` in `config`, with the secrets under it. */
const visitAnchors = (
  config: unknown,
  slot: ISecretSlot,
  visit: (anchor: unknown, secrets: string[]) => void
) => {
  mapPath(config, slot.anchor ?? [], (anchor) => {
    const secrets: string[] = [];
    mapPath(anchor, slot.secret, (value) => {
      if (isSecretValue(value)) secrets.push(value);
      return value;
    });
    visit(anchor, secrets);
    return anchor;
  });
};

const endpointValues = (slot: ISecretSlot, anchor: unknown) =>
  (slot.endpoint ?? []).map(({ path, unset }) => fieldValue(anchor, path) ?? unset);

/** `config` as an API returns it: every secret the slots declare replaced by its mask. */
export const maskSecrets = <T>(config: T, slots: readonly ISecretSlot[]): T =>
  slots.reduce<unknown>(
    (node, slot) =>
      mapPath(node, slot.anchor ?? [], (anchor) =>
        mapPath(anchor, slot.secret, (value) => (isSecretValue(value) ? maskSecret(value) : value))
      ),
    config
  ) as T;

const endpointChanged = (field: string) =>
  new CustomHttpException(
    `A saved secret can only be sent to the address it was saved for. Enter ${field} again.`,
    HttpErrorCode.VALIDATION_ERROR,
    { localization: { i18nKey: 'httpErrors.secret.endpointChanged', context: { field } } }
  );

const staleMask = (field: string) =>
  new CustomHttpException(
    `The saved ${field} changed since this page was loaded. Enter it again.`,
    HttpErrorCode.VALIDATION_ERROR,
    { localization: { i18nKey: 'httpErrors.secret.staleMask', context: { field } } }
  );

interface IStoredSecret {
  group: string;
  mask: string;
  secret: string;
  endpoint: unknown[];
}

const collectStored = (sources: readonly unknown[], slots: readonly ISecretSlot[]) => {
  const stored: IStoredSecret[] = [];
  for (const source of sources) {
    for (const slot of slots) {
      visitAnchors(source, slot, (anchor, secrets) => {
        const endpoint = endpointValues(slot, anchor);
        for (const secret of secrets) {
          stored.push({ group: groupOf(slot), mask: maskSecret(secret), secret, endpoint });
        }
      });
    }
  }
  return stored;
};

/**
 * An incoming config with each mask resolved to the stored secret it stands for: one of the
 * same slot group, among `sources` (the stored configs it may come from), saved for the same
 * endpoint. Plaintext passes through. A mask whose secret was saved for another endpoint (or
 * slot group), or that matches no stored secret, is refused, never saved or sent as the secret.
 *
 * `root` is the config the incoming one is about to become, for a section patch merged over
 * the stored config: endpoint fields of root-anchored slots are read from it.
 */
export const unmaskSecrets = <T>(
  incoming: T,
  sources: readonly unknown[],
  slots: readonly ISecretSlot[],
  root: unknown = incoming
): T => {
  if (!JSON.stringify(incoming ?? null).includes(MASKED_SECRET_PREFIX)) return incoming;
  const stored = collectStored(sources, slots);
  return slots.reduce<unknown>(
    (node, slot) =>
      mapPath(node, slot.anchor ?? [], (anchor) => {
        const next = endpointValues(slot, slot.anchor?.length ? anchor : root);
        return mapPath(anchor, slot.secret, (value) => {
          if (!isMaskedSecret(value)) return value;
          const sameMask = stored.filter((s) => s.mask === value);
          if (!sameMask.length) throw staleMask(label(slot));
          const match = sameMask.find(
            (s) => s.group === groupOf(slot) && endpointKept(slot.endpoint, s.endpoint, next)
          );
          if (!match) throw endpointChanged(label(slot));
          return match.secret;
        });
      }),
    incoming
  ) as T;
};

/**
 * A section patch is merged over the stored config, so a patch that moves an endpoint other
 * slots point at (`anchor` at the root) would carry their stored secrets to the new address
 * without the client sending a single mask. Those secrets have to come with the patch again
 * (re-entered, or cleared) or the patch is refused.
 */
export const assertSecretsReentered = (
  stored: unknown,
  patch: unknown,
  slots: readonly ISecretSlot[]
): void => {
  if (!isRecord(stored) || !isRecord(patch)) return;
  const next = { ...stored, ...patch };
  const leftBehind = slots
    .filter((slot) => !slot.anchor?.length && slot.endpoint?.length && !(slot.secret[0] in patch))
    .filter((slot) => {
      let held = false;
      visitAnchors(stored, slot, (_anchor, secrets) => (held ||= secrets.length > 0));
      return (
        held &&
        !endpointKept(slot.endpoint, endpointValues(slot, stored), endpointValues(slot, next))
      );
    })
    .map((slot) => slot.secret[0]);
  if (leftBehind.length) {
    const fields = [...new Set(leftBehind)].join(', ');
    throw new CustomHttpException(
      `The address changed. Enter or clear ${fields} first.`,
      HttpErrorCode.VALIDATION_ERROR,
      { localization: { i18nKey: 'httpErrors.secret.reenterForNewAddress', context: { fields } } }
    );
  }
};
