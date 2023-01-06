import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { CreateFieldDto } from '../create-field.dto';
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
  getField(@Param('tableId') tableId: string, @Param('fieldId') fieldId: string) {
    return this.fieldService.getField(tableId, fieldId);
  }

  @ApiOperation({ summary: 'Create Field' })
  @ApiResponse({ status: 201, description: 'The field has been successfully created.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiParam({
    name: 'tableId',
    description: 'The id for table.',
    example: 'tbla63d4543eb5eded6',
  })
  @Post()
  createField(
    @Param('tableId') tableId: string,
    @Body() _createFieldDto: CreateFieldDto, // dto for swagger document
    @Body(FieldPipe) fieldInstance: IFieldInstance
  ) {
    console.log('fieldInstance: ', fieldInstance);
    return this.fieldOpenApiService.createField(tableId, fieldInstance);
  }
}
