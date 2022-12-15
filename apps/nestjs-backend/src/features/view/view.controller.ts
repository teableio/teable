import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { CreateViewDto } from './create-view.dto';
import { ViewService } from './view.service';

@ApiBearerAuth()
@ApiTags('view')
@Controller('api/table/:tableId/view')
export class ViewController {
  constructor(private readonly viewService: ViewService) {}

  @Get(':viewId')
  getView(@Param('tableId') tableId: string, @Param('viewId') viewId: string) {
    return this.viewService.getView(tableId, viewId);
  }

  @ApiOperation({ summary: 'Create view' })
  @ApiResponse({ status: 201, description: 'The view has been successfully created.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiParam({
    name: 'tableId',
    description: 'The id for table.',
    example: 'tbla63d4543eb5eded6',
  })
  @Post()
  createView(@Param('tableId') tableId: string, @Body() createViewDto: CreateViewDto) {
    return this.viewService.createView(tableId, createViewDto);
  }
}
