/* eslint-disable sonarjs/no-duplicate-string */
import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  Get,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  ICreateBaseVo,
  IUpdateBaseVo,
  IGetBaseVo,
  IDbConnectionVo,
} from '@teable-group/openapi';
import {
  createBaseRoSchema,
  ICreateBaseRo,
  updateBaseRoSchema,
  IUpdateBaseRo,
} from '@teable-group/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionGuard } from '../auth/guard/permission.guard';
import { BaseService } from './base.service';
import { DbConnectionService } from './db-connection.service';

@ApiTags('api/base')
@Controller('api/base')
@UseGuards(PermissionGuard)
export class BaseController {
  constructor(
    private readonly baseService: BaseService,
    private readonly dbConnectionService: DbConnectionService
  ) {}

  @Permissions('base|create')
  @Post()
  async createBase(
    @Body(new ZodValidationPipe(createBaseRoSchema))
    createBaseRo: ICreateBaseRo
  ): Promise<ICreateBaseVo> {
    return await this.baseService.createBase(createBaseRo);
  }

  @Permissions('base|update')
  @Patch(':baseId')
  async updateBase(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(updateBaseRoSchema))
    updateBaseRo: IUpdateBaseRo
  ): Promise<IUpdateBaseVo> {
    return await this.baseService.updateBase(baseId, updateBaseRo);
  }

  @Permissions('base|read')
  @Get(':baseId')
  async getBaseById(@Param('baseId') baseId: string): Promise<IGetBaseVo> {
    return await this.baseService.getBaseById(baseId);
  }

  @Permissions('base|read')
  @Get()
  async getBaseList(@Query('spaceId') spaceId?: string): Promise<IGetBaseVo[]> {
    return await this.baseService.getBaseList(spaceId);
  }

  @Permissions('base|delete')
  @Delete(':baseId')
  async deleteBase(@Param('baseId') baseId: string) {
    await this.baseService.deleteBase(baseId);
    return null;
  }

  @Permissions('base|read')
  @Post(':baseId/connection')
  async createDbConnection(@Param('baseId') baseId: string): Promise<IDbConnectionVo> {
    return await this.dbConnectionService.create(baseId);
  }

  @Permissions('base|update')
  @Get(':baseId/connection')
  async getDBConnection(@Param('baseId') baseId: string): Promise<IDbConnectionVo | null> {
    return await this.dbConnectionService.retrieve(baseId);
  }

  @Permissions('base|update')
  @Delete(':baseId/connection')
  async deleteDbConnection(@Param('baseId') baseId: string) {
    await this.dbConnectionService.remove(baseId);
    return null;
  }
}
