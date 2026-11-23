import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { Action } from '@teable/core';
import type { IClsStore } from '../../types/cls';

/** Server-captured issuance ceiling for a queued PAT; never an HTTP input or raw credential. */
export interface IQueuedCredentialCeiling {
  readonly accessTokenId: string;
  readonly userId: string;
  readonly scopes: readonly Action[];
  readonly spaceIds: readonly string[];
  readonly baseIds: readonly string[];
  readonly hasFullAccess: boolean;
  readonly signFingerprint: string;
  readonly expiresAt: number | null;
  readonly clientId: string | null;
  readonly authSource?: IClsStore['authSource'];
  readonly appId?: string;
  readonly tempAuthBaseId?: string;
  readonly sandboxPrincipal?: IClsStore['sandboxPrincipal'];
}

const queuedCredentialScope = new AsyncLocalStorage<Readonly<IQueuedCredentialCeiling>>();

export const fingerprintQueuedCredentialSign = (sign: string): string =>
  createHash('sha256').update(sign).digest('hex');

export const currentQueuedCredentialCeiling = () => queuedCredentialScope.getStore();

/** Only trusted host workers enter this frame; all nested async native calls inherit it. */
export const runWithQueuedCredentialCeiling = <T>(
  ceiling: IQueuedCredentialCeiling,
  run: () => Promise<T>
): Promise<T> => queuedCredentialScope.run(Object.freeze({
  ...ceiling,
  scopes: Object.freeze([...ceiling.scopes]),
  spaceIds: Object.freeze([...ceiling.spaceIds]),
  baseIds: Object.freeze([...ceiling.baseIds]),
  ...(ceiling.sandboxPrincipal && { sandboxPrincipal: Object.freeze({ ...ceiling.sandboxPrincipal }) }),
}), run);
