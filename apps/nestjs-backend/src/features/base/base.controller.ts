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
import { ISqlQuerySchemaRo, sqlQuerySchemaRo } from './base.schema';
import { BaseService } from './base.service';

@ApiTags('api/base')
@Controller('api/base')
export class BaseController {
  constructor(private readonly baseService: BaseService) {}

  @Post('sqlQuery')
  async sqlQuery(@Body(new ZodValidationPipe(sqlQuerySchemaRo)) param: ISqlQuerySchemaRo) {
    return await this.baseService.sqlQuery(param.tableId, param.viewId, param.sql);
  }

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
