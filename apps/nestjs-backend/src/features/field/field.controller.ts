import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { CreateFieldDto } from './create-field.dto';
import { FieldService } from './field.service';

@ApiBearerAuth()
@ApiTags('field')
@Controller('api/table/:tableId/field')
export class FieldController {
  constructor(private readonly fieldService: FieldService) {}

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
    example: 'tbl80ba3a85e3f843b0',
  })
  @Post()
  createField(@Param('tableId') tableId: string, @Body() createFieldDto: CreateFieldDto) {
    return this.fieldService.createField(tableId, createFieldDto);
  }
}
