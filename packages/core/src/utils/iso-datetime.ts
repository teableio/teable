import { z } from '../zod';

/**
 * An ISO 8601 datetime string, e.g. `2024-01-01T06:15:30.000Z`, or with `offset: true` also
 * `2024-01-01T14:15:30+08:00`.
 *
 * zod 4.5 made `z.iso.datetime()` require seconds. Earlier versions also accepted minute precision
 * (`2024-01-01T06:15Z`), and API clients, AI tool calls and stored configs may still carry it, so
 * both forms stay valid.
 */
export const isoDateTimeSchema = (params?: { offset?: boolean }) =>
  z
    .union([
      z.iso.datetime({ offset: params?.offset }),
      z.iso.datetime({ offset: params?.offset, precision: -1 }),
    ])
    .meta({ type: 'string', format: 'date-time' });
