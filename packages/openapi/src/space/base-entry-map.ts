import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_SPACE_BASE_ENTRY_MAP = '/space/{spaceId}/base-entry-map';

/** What the client passes today; the endpoint itself has no implicit limit */
export const baseEntryMapDefaultTake = 100;

export const getBaseEntryMapRoSchema = z.object({
  spaceId: z.string(),
  take: z
    .union([z.string(), z.number()])
    .transform(Number)
    .pipe(z.number().int().min(1))
    .optional()
    .meta({
      description:
        'Resolve at most this many bases, in base-list order; omitted means the whole list',
    }),
});

export type IGetBaseEntryMapRo = z.infer<typeof getBaseEntryMapRoSchema>;

/**
 * baseId → entry pathname for the accessible bases of the space:
 * /base/{baseId}/table/{tableId}/{viewId} when the user's last visited view
 * is known, otherwise viewless (the table route resolves the view with
 * permission filtering, one redirect). Resolved from the user's own visit
 * history, falling back to the base's default first table; bases whose
 * target is a non-table node are omitted and keep the redirect chain.
 */
export const baseEntryMapVoSchema = z.record(z.string(), z.string());

export type IBaseEntryMapVo = z.infer<typeof baseEntryMapVoSchema>;

export const GetBaseEntryMapRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SPACE_BASE_ENTRY_MAP,
  description:
    'Resolve the entry URL (last visited table and view) of the accessible bases in a space, so base-list clicks can navigate straight to the final URL',
  request: {
    params: z.object({ spaceId: z.string() }),
    query: getBaseEntryMapRoSchema.pick({ take: true }),
  },
  responses: {
    200: {
      description: 'Returns a map of baseId to entry URL pathname.',
      content: {
        'application/json': {
          schema: baseEntryMapVoSchema,
        },
      },
    },
  },
  tags: ['space'],
});

export const getBaseEntryMap = async (params: IGetBaseEntryMapRo) => {
  const { spaceId, take } = params;
  return axios.get<IBaseEntryMapVo>(urlBuilder(GET_SPACE_BASE_ENTRY_MAP, { spaceId }), {
    params: { take },
  });
};
