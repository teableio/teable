import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute } from '../../utils';

export const RETRY_ENTERPRISE_LICENSE_AUTO_FETCH = '/admin/enterprise-license/auto-fetch/retry';

export const RetryEnterpriseLicenseAutoFetchRoute: RouteConfig = registerRoute({
  method: 'post',
  path: RETRY_ENTERPRISE_LICENSE_AUTO_FETCH,
  description: 'Retry enterprise license auto-renewal immediately',
  request: {},
  responses: {
    200: {
      description: 'Enterprise license auto-renewal retried successfully.',
    },
  },
  tags: ['admin'],
});

export const retryEnterpriseLicenseAutoFetch = async () => {
  return axios.post(RETRY_ENTERPRISE_LICENSE_AUTO_FETCH);
};
