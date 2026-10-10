import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { BillingProductLevel } from '../billing/subscription/get-subscription-summary';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const USER_INFO = '/auth/user';

export const userInfoVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatar: z.string().optional().nullable(),
  email: z.string().email().optional(),
});

export type IUserInfoVo = z.infer<typeof userInfoVoSchema>;

export const userInfoSpaceVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.nativeEnum(BillingProductLevel),
  seats: z.number().int().openapi({
    description:
      'For a plan bought per seat, the seats bought; otherwise (a plan granted another way, or none) the collaborators taking a seat.',
  }),
  creditsPerSeat: z.number().int().nullable().openapi({
    description:
      "Monthly credits per seat on the plan's rung of the credit density ladder (e.g. 2000 for Pro 2K, 8000 for Business 8K). Null for plans off the ladder: free, enterprise, AppSumo.",
  }),
  trial: z.boolean(),
});

export type IUserInfoSpaceVo = z.infer<typeof userInfoSpaceVoSchema>;

export const userInfoSelfHostedLicenseVoSchema = z.object({
  level: z.nativeEnum(BillingProductLevel),
  seats: z.number().int(),
  trial: z.boolean(),
});

export type IUserInfoSelfHostedLicenseVo = z.infer<typeof userInfoSelfHostedLicenseVoSchema>;

export const tokenUserInfoVoSchema = userInfoVoSchema.extend({
  spaces: z.array(userInfoSpaceVoSchema).optional().openapi({
    description:
      'With the user|spaces_read scope: the spaces the user takes a seat in (owner, creator or editor), each with its plan. Teable Cloud only.',
  }),
  selfHostedLicenses: z.array(userInfoSelfHostedLicenseVoSchema).optional().openapi({
    description:
      'With the user|self_hosted_licenses_read scope: the self-hosted licenses the user bought that are in force. Teable Cloud only.',
  }),
});

export type ITokenUserInfoVo = z.infer<typeof tokenUserInfoVoSchema>;

export const userInfoRoute: RouteConfig = registerRoute({
  method: 'get',
  path: USER_INFO,
  description: 'Get user information via access token',
  responses: {
    200: {
      description: 'Successfully retrieved user information',
      content: {
        'application/json': {
          schema: tokenUserInfoVoSchema,
        },
      },
    },
  },
  tags: ['auth'],
});

export const userInfo = async () => {
  return axios.get<ITokenUserInfoVo>(USER_INFO);
};
