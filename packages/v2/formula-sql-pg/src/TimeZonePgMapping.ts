import { match } from '@teable/v2-core';

/**
 * Maps Teable internal timezone representation to PostgreSQL timezone format.
 *
 * Teable uses lowercase 'utc' internally for consistency,
 * but PostgreSQL conventionally uses 'UTC'.
 * All other IANA timezone names are passed through unchanged.
 */
export const mapTimeZoneToPg = (tz: string): string => {
  return match(tz)
    .with('utc', () => 'UTC')
    .otherwise(() => tz);
};
