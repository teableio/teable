import { Body, Controller, Param, Patch, Post, Get, Delete } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BaseSchema } from '@teable-group/openapi';
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
    @Body(new ZodValidationPipe(BaseSchema.createBaseRoSchema))
    createBaseRo: BaseSchema.ICreateBaseRo
  ): Promise<BaseSchema.ICreateBaseVo> {
    return await this.baseService.createBase(createBaseRo);
  }

  @Patch(':baseId')
  async updateBase(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(BaseSchema.updateBaseRoSchema))
    updateBaseRo: BaseSchema.IUpdateBaseRo
  ): Promise<BaseSchema.IUpdateBaseVo> {
    return await this.baseService.updateBase(baseId, updateBaseRo);
  }

  @Get(':baseId')
  async getBaseById(@Param('baseId') baseId: string): Promise<BaseSchema.IGetBaseVo> {
    return await this.baseService.getBaseById(baseId);
  }

  @Get()
  async getBaseList(): Promise<BaseSchema.IGetBaseVo[]> {
    return await this.baseService.getBaseList();
  }

  @Delete(':baseId')
  async deleteBase(@Param('baseId') baseId: string) {
    await this.baseService.deleteBase(baseId);
    return null;
  }
}
