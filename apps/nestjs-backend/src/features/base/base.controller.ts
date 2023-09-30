import { Body, Controller, Param, Patch, Post, Get, Delete } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { ICreateBaseVo, IUpdateBaseVo, IGetBaseVo } from '@teable-group/openapi';
import {
  createBaseRoSchema,
  ICreateBaseRo,
  updateBaseRoSchema,
  IUpdateBaseRo,
} from '@teable-group/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { BaseService } from './base.service';

@ApiTags('api/base')
@Controller('api/base')
export class BaseController {
  constructor(private readonly baseService: BaseService) {}

  @Post()
  async createBase(
    @Body(new ZodValidationPipe(createBaseRoSchema))
    createBaseRo: ICreateBaseRo
  ): Promise<ICreateBaseVo> {
    return await this.baseService.createBase(createBaseRo);
  }

  @Patch(':baseId')
  async updateBase(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(updateBaseRoSchema))
    updateBaseRo: IUpdateBaseRo
  ): Promise<IUpdateBaseVo> {
    return await this.baseService.updateBase(baseId, updateBaseRo);
  }

  @Get(':baseId')
  async getBaseById(@Param('baseId') baseId: string): Promise<IGetBaseVo> {
    return await this.baseService.getBaseById(baseId);
  }

  @Get()
  async getBaseList(): Promise<IGetBaseVo[]> {
    return await this.baseService.getBaseList();
  }

  @Delete(':baseId')
  async deleteBase(@Param('baseId') baseId: string) {
    await this.baseService.deleteBase(baseId);
    return null;
  }
}
