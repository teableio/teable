import type { IUserInfoSelfHostedLicenseVo, IUserInfoSpaceVo } from '@teable/openapi';

/**
 * What a user pays for, read into the userinfo of a token holding `user|spaces_read` or
 * `user|self_hosted_licenses_read`. Plans live in billing, which only the enterprise backend
 * has: it provides this on Teable Cloud through the injection token (optional dependency),
 * and without it the userinfo leaves both out.
 */
export const USER_PLANS_RESOLVER = 'USER_PLANS_RESOLVER';

export interface IUserPlansResolver {
  /** The spaces the user takes a seat in, each with its plan. */
  getSpaces(userId: string): Promise<IUserInfoSpaceVo[]>;
  /** The self-hosted licenses the user bought that are in force. */
  getSelfHostedLicenses(userId: string): Promise<IUserInfoSelfHostedLicenseVo[]>;
}
