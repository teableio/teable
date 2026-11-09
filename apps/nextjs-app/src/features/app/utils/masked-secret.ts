import { isMaskedSecret } from '@teable/openapi';

/**
 * How the backend binds a saved secret to the endpoint it is sent to. A mask written back
 * resolves to the saved secret only while that binding holds; otherwise the request is refused.
 * - `strict`: the endpoint is unchanged.
 * - `orDefault`: the endpoint is unchanged or cleared (the provider's official default).
 */
export type IMaskEndpointMode = 'strict' | 'orDefault';

export interface IMaskEndpoint {
  /** The endpoint the form was loaded with. */
  savedEndpoint: unknown;
  /** The endpoint as the form would send it now. */
  nextEndpoint: unknown;
  mode: IMaskEndpointMode;
}

/** Whether a mask still resolves to its saved secret once the endpoint becomes `nextEndpoint`. */
export const isMaskStillValid = ({ savedEndpoint, nextEndpoint, mode }: IMaskEndpoint): boolean => {
  if (mode === 'orDefault' && !nextEndpoint) return true;
  // Compared as text, as the backend does: a port typed as '465' is the saved 465.
  return String(savedEndpoint ?? '') === String(nextEndpoint ?? '');
};

/**
 * Whether `secret` is a mask that one of its endpoint changes has invalidated: the form clears it
 * and asks for the secret again instead of sending a mask the backend refuses.
 */
export const isStaleMaskedSecret = (secret: unknown, endpoints: IMaskEndpoint[]): boolean =>
  isMaskedSecret(secret) && endpoints.some((endpoint) => !isMaskStillValid(endpoint));

/**
 * What a secret field becomes once one of its endpoints changes, or `undefined` to leave it:
 * - its mask stopped resolving: emptied (`cleared`), so the secret is entered again;
 * - every endpoint is back to what the mask resolves for, and the field still holds nothing
 *   since it was emptied that way: the saved mask comes back (typed or user-cleared input stays).
 */
export const reconcileMaskedSecret = ({
  secret,
  savedSecret,
  cleared,
  endpoints,
}: {
  secret: unknown;
  savedSecret: unknown;
  cleared: boolean;
  endpoints: IMaskEndpoint[];
}): { value: string; cleared: boolean } | undefined => {
  if (isStaleMaskedSecret(secret, endpoints)) return { value: '', cleared: true };
  if (cleared && !secret && isMaskedSecret(savedSecret) && endpoints.every(isMaskStillValid)) {
    return { value: savedSecret, cleared: false };
  }
  return undefined;
};
