import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { integrityIssueSchema } from './link-check';

export const FIX_BASE_INTEGRITY = '/integrity/base/{baseId}/link-fix';

export const IntegrityFixRoute: RouteConfig = registerRoute({
  method: 'post',
  path: FIX_BASE_INTEGRITY,
  description: 'Fix integrity of link fields in a base',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    201: {
      description: 'Success',
      content: {
        'application/json': {
          schema: z.array(integrityIssueSchema),
        },
      },
    },
  },
  tags: ['integrity'],
});

export const fixBaseIntegrity = async (baseId: string) => {
  return axios.post(
    urlBuilder(FIX_BASE_INTEGRITY, {
      baseId,
    })
  );
};
