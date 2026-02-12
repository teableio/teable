import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { IBaseShareVo } from '@teable/openapi';
import {
  createBaseShareRoSchema,
  updateBaseShareRoSchema,
  ICreateBaseShareRo,
  IUpdateBaseShareRo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionGuard } from '../auth/guard/permission.guard';
import { BaseShareService } from './base-share.service';

@Controller('api/base/:baseId/share')
@UseGuards(PermissionGuard)
export class BaseShareController {
  constructor(private readonly baseShareService: BaseShareService) {}

  @Post()
  // eslint-disable-next-line sonarjs/no-duplicate-string
  @Permissions('base|update')
  async create(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(createBaseShareRoSchema)) data: ICreateBaseShareRo
  ): Promise<IBaseShareVo> {
    return this.baseShareService.createBaseShare(baseId, data);
  }

  @Get()
  @Permissions('base|read')
  async list(@Param('baseId') baseId: string): Promise<{ nodeId: string }[]> {
    return this.baseShareService.getBaseShareList(baseId);
  }

  @Get('node/:nodeId')
  @Permissions('base|read')
  async getByNodeId(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string
  ): Promise<IBaseShareVo | null> {
    return this.baseShareService.getBaseShareByNodeId(baseId, nodeId);
  }

  @Patch(':shareId')
  @Permissions('base|update')
  async update(
    @Param('baseId') baseId: string,
    @Param('shareId') shareId: string,
    @Body(new ZodValidationPipe(updateBaseShareRoSchema)) data: IUpdateBaseShareRo
  ): Promise<IBaseShareVo> {
    return this.baseShareService.updateBaseShare(baseId, shareId, data);
  }

  @Delete(':shareId')
  @Permissions('base|update')
  async delete(@Param('baseId') baseId: string, @Param('shareId') shareId: string): Promise<void> {
    return this.baseShareService.deleteBaseShare(baseId, shareId);
  }

  @Post(':shareId/refresh')
  @Permissions('base|update')
  async refresh(
    @Param('baseId') baseId: string,
    @Param('shareId') shareId: string
  ): Promise<IBaseShareVo> {
    return this.baseShareService.refreshBaseShareId(baseId, shareId);
  }
}
