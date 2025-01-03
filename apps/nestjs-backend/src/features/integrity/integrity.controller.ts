import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { IIntegrityCheckVo, IIntegrityIssue } from '@teable/openapi';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionGuard } from '../auth/guard/permission.guard';
import { LinkIntegrityService } from './link-integrity.service';

@UseGuards(PermissionGuard)
@Controller('api/integrity')
export class IntegrityController {
  constructor(private readonly linkIntegrityService: LinkIntegrityService) {}

  @Permissions('table|create')
  @Get('base/:baseId/link-check')
  async checkBaseIntegrity(@Param('baseId') baseId: string): Promise<IIntegrityCheckVo> {
    return await this.linkIntegrityService.linkIntegrityCheck(baseId);
  }

  @Permissions('table|create')
  @Post('base/:baseId/link-fix')
  async fixBaseIntegrity(@Param('baseId') baseId: string): Promise<IIntegrityIssue[]> {
    return await this.linkIntegrityService.linkIntegrityFix(baseId);
  }
}
