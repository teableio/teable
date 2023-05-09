/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiForbiddenResponse,
  ApiCreatedResponse,
  ApiBody,
} from '@nestjs/swagger';
import { ApiResponse, responseWrap } from '../../../utils/api-response';
import { FieldService } from '../field.service';
import { CreateFieldRo } from '../model/create-field.ro';
import { IFieldInstance } from '../model/factory';
import { GetFieldsRo } from '../model/get-fields.ro';
import { UpdateFieldRo } from '../model/update-field.ro';
import { FieldOpenApiService } from './field-open-api.service';
import { FieldResponseVo } from './field-response.vo';
import { FieldPipe } from './field.pipe';
import { FieldsResponseVo } from './fields-response.vo';

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
    type: FieldResponseVo,
  })
  async getField(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string
  ): Promise<FieldResponseVo> {
    const fieldVo = await this.fieldService.getField(tableId, fieldId);
    return responseWrap(fieldVo);
  }

  @Get()
  @ApiOperation({ summary: 'Batch fetch fields' })
  @ApiOkResponse({
    description: 'Field',
    type: FieldsResponseVo,
  })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  async getFields(
    @Param('tableId') tableId: string,
    @Query() query: GetFieldsRo
  ): Promise<FieldsResponseVo> {
    const fieldsVo = await this.fieldService.getFields(tableId, query);
    return responseWrap(fieldsVo);
  }

  @Post()
  @ApiOperation({ summary: 'Create Field' })
  @ApiCreatedResponse({ description: 'The field has been successfully created.' })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  @ApiBody({
    type: CreateFieldRo,
  })
  @ApiOkResponse({
    description: 'Field',
    type: ApiResponse<null>,
    isArray: true,
  })
  async createField(
    @Param('tableId') tableId: string,
    @Body(FieldPipe) fieldInstance: IFieldInstance
  ) {
    await this.fieldOpenApiService.createField(tableId, fieldInstance);
    return responseWrap(null);
  }

  @Put(':fieldId')
  @ApiOperation({ summary: 'Update field by id' })
  @ApiOkResponse({ description: 'The field has been successfully updated.' })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  @ApiBody({
    type: UpdateFieldRo,
  })
  async updateFieldById(
    @Param('tableId') tableId: string,
    @Param('fieldId') fieldId: string,
    @Body() updateFieldRo: UpdateFieldRo
  ) {
    const res = await this.fieldOpenApiService.updateFieldById(tableId, fieldId, updateFieldRo);
    return responseWrap(res);
  }
}
