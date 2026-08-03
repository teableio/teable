import { Controller, Get } from '@nestjs/common';
import type {
  IGetDepartmentListVo,
  IGetDepartmentUserVo,
  IOrganizationMeVo,
} from '@teable/openapi';

@Controller('api/organization')
export class OrganizationController {
  @Get('me')
  async getOrganizationMe(): Promise<IOrganizationMeVo> {
    return null;
  }

  @Get('department-user')
  async getDepartmentUsers(): Promise<IGetDepartmentUserVo> {
    return {
      users: [],
      total: 0,
    };
  }

  @Get('department')
  async getDepartmentList(): Promise<IGetDepartmentListVo> {
    return [];
  }
}
