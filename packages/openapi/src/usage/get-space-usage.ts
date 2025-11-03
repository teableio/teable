import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../axios';
import { BillingProductLevel } from '../billing';
import { registerRoute, urlBuilder } from '../utils';

export enum UsageFeature {
  NumRows = 'numRows',
  AttachmentSize = 'attachmentSize',
  NumDatabaseConnections = 'numDatabaseConnections',
  NumCollaborators = 'numCollaborators',
}

export const usageFeatureSchema = z.object({
  [UsageFeature.NumRows]: z.number(),
  [UsageFeature.AttachmentSize]: z.number(),
  [UsageFeature.NumDatabaseConnections]: z.number(),
  [UsageFeature.NumCollaborators]: z.number(),
});

export enum UsageFeatureLimit {
  MaxRows = 'maxRows',
  MaxSizeAttachments = 'maxSizeAttachments',
  MaxNumDatabaseConnections = 'maxNumDatabaseConnections',
  MaxRevisionHistoryDays = 'maxRevisionHistoryDays',
  MaxAutomationHistoryDays = 'maxAutomationHistoryDays',
  AutomationEnable = 'automationEnable',
  AuditLogEnable = 'auditLogEnable',
  AdminPanelEnable = 'adminPanelEnable',
  RowColoringEnable = 'rowColoringEnable',
  ButtonFieldEnable = 'buttonFieldEnable',
  FieldAIEnable = 'fieldAIEnable',
  UserGroupEnable = 'userGroupEnable',
  AdvancedExtensionsEnable = 'advancedExtensionsEnable',
  AdvancedPermissionsEnable = 'advancedPermissionsEnable',
  PasswordRestrictedSharesEnable = 'passwordRestrictedSharesEnable',
  AuthenticationEnable = 'authenticationEnable',
  DomainVerificationEnable = 'domainVerificationEnable',
  OrganizationEnable = 'organizationEnable',
  APIRateLimit = 'apiRateLimit',
  ChatAIEnable = 'chatAIEnable',
  AppEnable = 'appEnable',
  CustomDomainEnable = 'customDomainEnable',
}

export const usageFeatureLimitSchema = z.object({
  [UsageFeatureLimit.MaxRows]: z.number(),
  [UsageFeatureLimit.MaxSizeAttachments]: z.number(),
  [UsageFeatureLimit.MaxNumDatabaseConnections]: z.number(),
  [UsageFeatureLimit.MaxRevisionHistoryDays]: z.number(),
  [UsageFeatureLimit.MaxAutomationHistoryDays]: z.number(),
  [UsageFeatureLimit.AutomationEnable]: z.boolean(),
  [UsageFeatureLimit.AuditLogEnable]: z.boolean(),
  [UsageFeatureLimit.AdminPanelEnable]: z.boolean(),
  [UsageFeatureLimit.RowColoringEnable]: z.boolean(),
  [UsageFeatureLimit.ButtonFieldEnable]: z.boolean(),
  [UsageFeatureLimit.FieldAIEnable]: z.boolean(),
  [UsageFeatureLimit.UserGroupEnable]: z.boolean(),
  [UsageFeatureLimit.AdvancedExtensionsEnable]: z.boolean(),
  [UsageFeatureLimit.AdvancedPermissionsEnable]: z.boolean(),
  [UsageFeatureLimit.PasswordRestrictedSharesEnable]: z.boolean(),
  [UsageFeatureLimit.AuthenticationEnable]: z.boolean(),
  [UsageFeatureLimit.DomainVerificationEnable]: z.boolean(),
  [UsageFeatureLimit.OrganizationEnable]: z.boolean(),
  [UsageFeatureLimit.APIRateLimit]: z.number(),
  [UsageFeatureLimit.ChatAIEnable]: z.boolean(),
  [UsageFeatureLimit.AppEnable]: z.boolean(),
  [UsageFeatureLimit.CustomDomainEnable]: z.boolean(),
});

export const usageVoSchema = z.object({
  level: z.nativeEnum(BillingProductLevel),
  limit: usageFeatureLimitSchema,
});

export type IUsageVo = z.infer<typeof usageVoSchema>;

export const GET_SPACE_USAGE = '/space/{spaceId}/usage';

export const GetSpaceUsageRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SPACE_USAGE,
  description: 'Get usage information for the space',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns usage information for the space.',
      content: {
        'application/json': {
          schema: usageVoSchema,
        },
      },
    },
  },
  tags: ['usage'],
});

export const getSpaceUsage = async (spaceId: string) => {
  return axios.get<IUsageVo>(urlBuilder(GET_SPACE_USAGE, { spaceId }));
};
