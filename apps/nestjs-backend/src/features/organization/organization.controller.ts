import { Controller, Get } from '@nestjs/common';
import type { IOrganizationMeVo } from '@teable/openapi';

@Controller('api/organization')
export class OrganizationController {
  @Get('me')
  async getOrganizationMe(): Promise<IOrganizationMeVo> {
    return null;
  }
}
