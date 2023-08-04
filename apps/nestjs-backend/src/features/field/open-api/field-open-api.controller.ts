/* eslint-disable sonarjs/no-duplicate-string */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiForbiddenResponse,
  ApiCreatedResponse,
  ApiBody,
} from '@nestjs/swagger';
import type { IFieldVo } from '@teable-group/core';
import {
  getFieldsQuerySchema,
  IGetFieldsQuery,
  IUpdateFieldRo,
  updateFieldRoSchema,
  fieldRoSchema,
} from '@teable-group/core';
import { ApiResponse, responseWrap } from '../../../utils/api-response';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { FieldService } from '../field.service';
import { IFieldInstance } from '../model/factory';
import { FieldOpenApiService } from './field-open-api.service';
import { FieldPipe } from './field.pipe';

@ApiBearerAuth()
@ApiTags('field')
@Controller('api/table/:tableId/field')
export class FieldOpenApiController {
  constructor(
    private readonly fieldService: FieldService,
    private readonly fieldOpenApiService: FieldOpenApiService
  ) {}

  @Get(':fieldId')
  @ApiOperation({ summary: 'Get a specific field' })
  @ApiOkResponse({
    description: 'Field',
    type: ApiResponse<IFieldVo>,
  })
  async getField(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string
  ): Promise<ApiResponse<IFieldVo>> {
    try {
      const fieldVo = await this.fieldService.getField(tableId, fieldId);
      return responseWrap(fieldVo);
    } catch (e) {
      throw new HttpException('field no found', HttpStatus.NOT_FOUND);
    }
  }

  @Get()
  @ApiOperation({ summary: 'Batch fetch fields' })
  @ApiOkResponse({
    description: 'Field',
    type: ApiResponse<IFieldVo[]>,
  })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  async getFields(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(getFieldsQuerySchema)) query: IGetFieldsQuery
  ): Promise<ApiResponse<IFieldVo[]>> {
    const fieldsVo = await this.fieldService.getFields(tableId, query);
    return responseWrap(fieldsVo);
  }

  @Post()
  @ApiOperation({ summary: 'Create Field' })
  @ApiCreatedResponse({ description: 'The field has been successfully created.' })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  @ApiOkResponse({
    description: 'Field',
    type: ApiResponse<IFieldVo>,
    isArray: true,
  })
  async createField(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(fieldRoSchema), FieldPipe) fieldInstance: IFieldInstance
  ): Promise<ApiResponse<IFieldVo>> {
    const fieldVo = await this.fieldOpenApiService.createField(tableId, fieldInstance);
    return responseWrap(fieldVo);
  }

  @Put(':fieldId')
  @ApiOperation({ summary: 'Update field by id' })
  @ApiOkResponse({ description: 'The field has been successfully updated.' })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  @ApiBody({
    type: ApiResponse<IUpdateFieldRo>,
  })
  async updateFieldById(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(updateFieldRoSchema)) updateFieldRo: IUpdateFieldRo
  ) {
    const res = await this.fieldOpenApiService.updateFieldById(tableId, fieldId, updateFieldRo);
    return responseWrap(res);
  }

  @Delete(':fieldId')
  @ApiOperation({ summary: 'Delete field by id' })
  @ApiOkResponse({ description: 'The field has been successfully deleted.' })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  async deleteField(@Param('tableId') tableId: string, @Param('fieldId') fieldId: string) {
    const res = await this.fieldOpenApiService.deleteField(tableId, fieldId);
    return responseWrap(res);
  }
}
