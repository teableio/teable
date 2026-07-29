import { useEnv } from './useEnv';

/**
 * The origin used to build user-facing absolute URLs (share links, short links).
 *
 * Prefers the browser origin so copied links always match the address the user
 * is visiting, falls back to the configured `PUBLIC_ORIGIN` env during SSR.
 * Returns an empty string when neither is available, so callers should guard
 * before building URLs.
 */
export const useOrigin = () => {
  const { publicOrigin } = useEnv();
  return (typeof window !== 'undefined' ? window.location.origin : '') || publicOrigin || '';
};
