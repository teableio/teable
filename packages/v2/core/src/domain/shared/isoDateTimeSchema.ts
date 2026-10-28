import { z } from 'zod';

/**
 * An ISO 8601 datetime string with a `Z` or `±hh:mm` offset, e.g. `2024-01-01T06:15:30.000Z`.
 *
 * zod 4.5 made `z.iso.datetime()` require seconds. Earlier versions also accepted minute precision
 * (`2024-01-01T06:15Z`), and stored view filters and data queries may carry it, so both forms stay
 * valid. Mirrors `isoDateTimeSchema` in `@teable/core`.
 */
export const isoDateTimeWithOffsetSchema = () =>
  z.union([z.iso.datetime({ offset: true }), z.iso.datetime({ offset: true, precision: -1 })]);
