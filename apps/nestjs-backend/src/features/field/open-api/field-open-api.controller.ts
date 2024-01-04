import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { IFieldVo } from '@teable-group/core';
import {
  fieldRoSchema,
  getFieldsQuerySchema,
  IFieldRo,
  IGetFieldsQuery,
  IUpdateFieldRo,
  updateFieldRoSchema,
} from '@teable-group/core';
import type { IPlanFieldUpdateVo, IPlanFieldVo } from '@teable-group/openapi';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionGuard } from '../../auth/guard/permission.guard';
import { FieldService } from '../field.service';
import { FieldOpenApiService } from './field-open-api.service';

@Controller('api/table/:tableId/field')
@UseGuards(PermissionGuard)
export class FieldOpenApiController {
  constructor(
    private readonly fieldService: FieldService,
    private readonly fieldOpenApiService: FieldOpenApiService
  ) {}

  @Permissions('field|read')
  @Get(':fieldId')
  async getField(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string
  ): Promise<IFieldVo> {
    return await this.fieldService.getField(tableId, fieldId);
  }

  @Permissions('field|read')
  @Get()
  async getFields(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(getFieldsQuerySchema)) query: IGetFieldsQuery
  ): Promise<IFieldVo[]> {
    return await this.fieldService.getFieldsByQuery(tableId, query);
  }

  @Permissions('field|create')
  @Post('/plan')
  async planFieldCreate(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(fieldRoSchema)) fieldRo: IFieldRo
  ): Promise<IPlanFieldVo> {
    return await this.fieldOpenApiService.planFieldCreate(tableId, fieldRo);
  }

  @Permissions('field|create')
  @Post()
  async createField(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(fieldRoSchema)) fieldRo: IFieldRo
  ): Promise<IFieldVo> {
    return await this.fieldOpenApiService.createField(tableId, fieldRo);
  }

  @Permissions('field|update')
  @Patch(':fieldId/plan')
  async planFieldUpdate(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(updateFieldRoSchema)) updateFieldRo: IUpdateFieldRo
  ): Promise<IPlanFieldUpdateVo> {
    return await this.fieldOpenApiService.planFieldUpdate(tableId, fieldId, updateFieldRo);
  }

  @Permissions('field|update')
  @Patch(':fieldId')
  async updateField(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(updateFieldRoSchema)) updateFieldRo: IUpdateFieldRo
  ) {
    return await this.fieldOpenApiService.updateField(tableId, fieldId, updateFieldRo);
  }

  @Permissions('field|delete')
  @Delete(':fieldId')
  async deleteField(@Param('tableId') tableId: string, @Param('fieldId') fieldId: string) {
    await this.fieldOpenApiService.deleteField(tableId, fieldId);
  }
}
