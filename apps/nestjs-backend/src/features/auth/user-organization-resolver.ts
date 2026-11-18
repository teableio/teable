import type { IClsStore } from '../../types/cls';

// Enterprise provides the same organization/departments used by HTTP authentication.
// Community has no organization principal, so this dependency is optional there.
export const USER_ORGANIZATION_RESOLVER = 'USER_ORGANIZATION_RESOLVER';

export interface IUserOrganizationResolver {
  getUserOrganization(userId: string): Promise<IClsStore['organization'] | null>;
}
