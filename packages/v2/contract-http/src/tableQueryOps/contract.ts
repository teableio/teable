import { oc } from '@orpc/contract';

import {
  getSearchAccessPathCapabilitiesInputSchema,
  getSearchAccessPathCapabilitiesOkResponseSchema,
  getSearchAccessPathStatusInputSchema,
  getSearchAccessPathStatusOkResponseSchema,
  reconcileSearchAccessPathInputSchema,
  reconcileSearchAccessPathOkResponseSchema,
} from './searchAccessPath';

export const v2TableQueryOpsContract = {
  searchAccessPath: {
    getStatus: oc
      .route({
        method: 'GET',
        path: '/table-query-ops/search-access-path/status',
        successStatus: 200,
        summary: 'Get managed search access-path status',
        tags: ['table-query-ops'],
      })
      .input(getSearchAccessPathStatusInputSchema)
      .output(getSearchAccessPathStatusOkResponseSchema),
    getCapabilities: oc
      .route({
        method: 'GET',
        path: '/table-query-ops/search-access-path/capabilities',
        successStatus: 200,
        summary: 'Get managed search access-path capabilities',
        tags: ['table-query-ops'],
      })
      .input(getSearchAccessPathCapabilitiesInputSchema)
      .output(getSearchAccessPathCapabilitiesOkResponseSchema),
    reconcile: oc
      .route({
        method: 'POST',
        path: '/table-query-ops/search-access-path/reconcile',
        successStatus: 200,
        summary: 'Reconcile a managed search access path',
        tags: ['table-query-ops'],
      })
      .input(reconcileSearchAccessPathInputSchema)
      .output(reconcileSearchAccessPathOkResponseSchema),
  },
};
