import { Controller, Get } from '@nestjs/common';
import type { IEnterpriseLicenseStatusVo } from '@teable/openapi';
import { Permissions } from '../../auth/decorators/permissions.decorator';

@Controller('api/admin/enterprise-license')
@Permissions('instance|read')
export class EnterpriseLicenseController {
  @Get('status')
  getStatus(): IEnterpriseLicenseStatusVo {
    return { expiredTime: null };
  }
}
