import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const GET_PIN_ENTRY_MAP = '/pin/entry-map';

/**
 * Entry pathname per pinned resource, keyed by baseId for base pins and by
 * tableId for table pins: /base/{baseId}/table/{tableId}/{viewId} when the
 * user's last visited view is known, otherwise viewless (the table route
 * resolves the view with permission filtering, one redirect). Unresolvable
 * pins are omitted — clicking falls back to the redirect chain.
 */
export const pinEntryMapVoSchema = z.record(z.string(), z.string());

export type IPinEntryMapVo = z.infer<typeof pinEntryMapVoSchema>;

export const GetPinEntryMapRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_PIN_ENTRY_MAP,
  description:
    "Resolve the entry URL of the current user's pinned bases and tables, so pin clicks can navigate straight to the final URL",
  responses: {
    200: {
      description: 'Returns a map of pinned resource id to entry URL pathname.',
      content: {
        'application/json': {
          schema: pinEntryMapVoSchema,
        },
      },
    },
  },
  tags: ['pin'],
});

export const getPinEntryMap = async () => {
  return axios.get<IPinEntryMapVo>(GET_PIN_ENTRY_MAP);
};
