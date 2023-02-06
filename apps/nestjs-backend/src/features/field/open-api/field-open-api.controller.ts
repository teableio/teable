import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
  ApiForbiddenResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { FieldService } from '../field.service';
import { CreateFieldRo } from '../model/create-field.ro';
import { IFieldInstance } from '../model/factory';
import { FieldVo } from '../model/field.vo';
import { GetFieldsRo } from '../model/get-fields.ro';
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
    type: FieldVo,
  })
  getField(@Param('tableId') tableId: string, @Param('fieldId') fieldId: string): Promise<FieldVo> {
    return this.fieldService.getField(tableId, fieldId);
  }

  @Get()
  @ApiOperation({ summary: 'Batch fetch fields' })
  @ApiOkResponse({
    description: 'Field',
    type: FieldVo,
    isArray: true,
  })
  @ApiForbiddenResponse({ status: 403, description: 'Forbidden.' })
  getFields(@Param('tableId') tableId: string, @Query() query: GetFieldsRo): Promise<FieldVo[]> {
    return this.fieldService.getFields(tableId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create Field' })
  @ApiCreatedResponse({ description: 'The field has been successfully created.' })
  @ApiForbiddenResponse({ status: 403, description: 'Forbidden.' })
  @ApiParam({
    name: 'tableId',
    description: 'The id for table.',
    example: 'tbla63d4543eb5eded6',
  })
  createField(
    @Param('tableId') tableId: string,
    @Body() _createFieldDto: CreateFieldRo, // dto for swagger document
    @Body(FieldPipe) fieldInstance: IFieldInstance
  ) {
    console.log('fieldInstance: ', fieldInstance);
    return this.fieldOpenApiService.createField(tableId, fieldInstance);
  }
}
