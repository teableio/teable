import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { contentQueryBaseSchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { aggregationRoSchema, aggregationVoSchema, type IAggregationVo } from './get-aggregation';

// Selection aggregation = the existing aggregation API + a row-range slice.
// Most params (viewId, ignoreViewQuery, filter, groupBy, search, field, ...)
// are inherited unchanged so the endpoint follows the same semantics that the
// frontend already uses for column-footer aggregations. Added on top:
//   - `orderBy`: aggregation itself is order-invariant, but slicing isn't —
//     the row order must align with the grid for the slice to be meaningful.
//   - `collapsedGroupIds`: when grouped views collapse some groups, those
//     records are hidden from the grid; the slice has to exclude them too,
//     otherwise skip/take indexes the wrong rows.
export const selectionAggregationRoSchema = aggregationRoSchema
  .extend(contentQueryBaseSchema.pick({ orderBy: true, collapsedGroupIds: true }).shape)
  .extend({
    skip: z.coerce.number().int().min(0).default(0),
    take: z.coerce.number().int().min(1),
  });

export type ISelectionAggregationRo = z.infer<typeof selectionAggregationRoSchema>;

export const selectionAggregationVoSchema = aggregationVoSchema;

export type ISelectionAggregationVo = IAggregationVo;

export const GET_SELECTION_AGGREGATION = '/table/{tableId}/aggregation/selection';

export const GetSelectionAggregationRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SELECTION_AGGREGATION,
  summary: 'Aggregate a contiguous row range for grid selection',
  description:
    'Same shape as GET /aggregation, plus skip/take to scope the aggregation to a contiguous slice [skip, skip+take) of the view-ordered rows. Used by the grid selection statistic chip when the selection covers rows not loaded on the client.',
  request: {
    params: z.object({ tableId: z.string() }),
    query: selectionAggregationRoSchema,
  },
  responses: {
    200: {
      description: 'Aggregation result for the selected row range',
      content: {
        'application/json': {
          schema: selectionAggregationVoSchema,
        },
      },
    },
  },
  tags: ['aggregation'],
});

export const getSelectionAggregation = async (
  tableId: string,
  query: ISelectionAggregationRo,
  config?: { signal?: AbortSignal }
) => {
  return axios.get<ISelectionAggregationVo>(urlBuilder(GET_SELECTION_AGGREGATION, { tableId }), {
    params: {
      ...query,
      filter: query.filter ? JSON.stringify(query.filter) : undefined,
      orderBy: query.orderBy ? JSON.stringify(query.orderBy) : undefined,
      groupBy: query.groupBy ? JSON.stringify(query.groupBy) : undefined,
      collapsedGroupIds: query.collapsedGroupIds
        ? JSON.stringify(query.collapsedGroupIds)
        : undefined,
    },
    signal: config?.signal,
  });
};
