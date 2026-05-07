import { Controller, Get, Param } from '@nestjs/common';
import { BillingProductLevel } from '@teable/openapi';
import type { IUsageVo } from '@teable/openapi';
import { Permissions } from '../auth/decorators/permissions.decorator';

export const ENTERPRISE_USAGE: IUsageVo = {
  level: BillingProductLevel.Enterprise,
  limit: {
    maxRows: 9_999_999_999,
    maxSizeAttachments: 9_999_999_999,
    maxNumAutomationRuns: 9_999_999_999,
    maxNumDatabaseConnections: 9_999_999_999,
    maxRevisionHistoryDays: 9_999_999_999,
    maxAutomationHistoryDays: 9_999_999_999,
    automationEnable: true,
    auditLogEnable: true,
    adminPanelEnable: true,
    rowColoringEnable: true,
    buttonFieldEnable: true,
    fieldAIEnable: true,
    userGroupEnable: true,
    advancedExtensionsEnable: true,
    advancedPermissionsEnable: true,
    passwordRestrictedSharesEnable: true,
    authenticationEnable: true,
    domainVerificationEnable: true,
    organizationEnable: true,
    apiRateLimit: 9_999_999_999,
    chatAIEnable: true,
    appEnable: true,
    customDomainEnable: true,
    maxNumAutomationSendEmail: 9_999_999_999,
  },
};

@Controller('api')
export class UsageController {
  // No @Permissions here: any authenticated user can read instance usage.
  // instance|read would restrict to admins only, but all EE users need this.
  @Get('instance/usage')
  getInstanceUsage(): IUsageVo {
    return ENTERPRISE_USAGE;
  }

  @Get('base/:baseId/usage')
  @Permissions('base|read')
  getBaseUsage(@Param('baseId') _baseId: string): IUsageVo {
    return ENTERPRISE_USAGE;
  }

  @Get('space/:spaceId/usage')
  @Permissions('space|read')
  getSpaceUsage(@Param('spaceId') _spaceId: string): IUsageVo {
    return ENTERPRISE_USAGE;
  }
}
