import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CreateViewRo } from '../model/create-view.ro';
import { IViewInstance } from '../model/factory';
import { ViewVo } from '../model/view.vo';
import { ViewService } from '../view.service';
import { ViewOpenApiService } from './view-open-api.service';
import { ViewPipe } from './view.pipe';

@ApiBearerAuth()
@ApiTags('view')
@Controller('api/table/:tableId/view')
export class ViewOpenApiController {
  constructor(
    private readonly viewService: ViewService,
    private readonly viewOpenApiService: ViewOpenApiService
  ) {}

  @Get(':viewId')
  @ApiOperation({ summary: 'Get a specific view' })
  @ApiOkResponse({
    description: 'View',
    type: ViewVo,
  })
  getView(@Param('tableId') _tableId: string, @Param('viewId') viewId: string): Promise<ViewVo> {
    return this.viewService.getViewById(viewId);
  }

  @Get()
  @ApiOperation({ summary: 'Batch fetch views' })
  @ApiOkResponse({
    description: 'View',
    type: ViewVo,
    isArray: true,
  })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  getViews(@Param('tableId') tableId: string): Promise<ViewVo[]> {
    return this.viewService.getViews(tableId);
  }

  @ApiOperation({ summary: 'Create view' })
  @ApiCreatedResponse({ description: 'The view has been successfully created.' })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  @ApiBody({
    type: CreateViewRo,
  })
  @Post()
  createView(@Param('tableId') tableId: string, @Body(ViewPipe) viewInstance: IViewInstance) {
    return this.viewOpenApiService.createView(tableId, viewInstance);
  }
}
