import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute } from '../../utils';
import { z } from '../../zod';

export const enterpriseLicenseStatusVoSchema = z.object({
  expiredTime: z.string().optional().nullable(),
});

export type IEnterpriseLicenseStatusVo = z.infer<typeof enterpriseLicenseStatusVoSchema>;

export const GET_ENTERPRISE_LICENSE_STATUS = '/admin/enterprise-license/status';

export const GetEnterpriseLicenseStatusRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_ENTERPRISE_LICENSE_STATUS,
  description: 'Get enterprise license expiration status',
  request: {},
  responses: {
    200: {
      description: 'Returns enterprise license expiration status.',
      content: {
        'application/json': {
          schema: enterpriseLicenseStatusVoSchema,
        },
      },
    },
  },
  tags: ['admin'],
});

export const getEnterpriseLicenseStatus = async () => {
  return axios.get<IEnterpriseLicenseStatusVo>(GET_ENTERPRISE_LICENSE_STATUS);
};
