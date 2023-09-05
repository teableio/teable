import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { IViewRo, IViewVo } from '@teable-group/core';
import { viewRoSchema, updateViewOrderRoSchema, IUpdateViewOrderRo } from '@teable-group/core';
import { ZodValidationPipe } from '../../..//zod.validation.pipe';
import { ApiResponse, responseWrap } from '../../../utils/api-response';
import { IViewInstance } from '../model/factory';
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
    type: ApiResponse<IViewVo>,
  })
  async getView(
    @Param('tableId') _tableId: string,
    @Param('viewId') viewId: string
  ): Promise<ApiResponse<IViewVo>> {
    const result = await this.viewService.getViewById(viewId);
    return responseWrap(result);
  }

  @Get()
  @ApiOperation({ summary: 'Batch fetch views' })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  async getViews(@Param('tableId') tableId: string): Promise<ApiResponse<IViewVo[]>> {
    const results = await this.viewService.getViews(tableId);
    return responseWrap(results);
  }

  @ApiOperation({ summary: 'Create view' })
  @ApiCreatedResponse({
    description: 'The view has been successfully created.',
    type: ApiResponse<IViewVo>,
  })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  @ApiBody({
    type: ApiResponse<IViewRo>,
  })
  @Post()
  async createView(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(viewRoSchema), ViewPipe) viewInstance: IViewInstance
  ): Promise<ApiResponse<IViewVo>> {
    const viewVo = await this.viewOpenApiService.createView(tableId, viewInstance);
    return responseWrap(viewVo);
  }

  @ApiOperation({ summary: 'Delete view' })
  @Delete('/:viewId')
  async deleteView(@Param('tableId') tableId: string, @Param('viewId') viewId: string) {
    const result = await this.viewOpenApiService.deleteView(tableId, viewId);
    return responseWrap(result);
  }

  @ApiOperation({ summary: 'Update view raw order' })
  @ApiCreatedResponse({
    description: 'The view raw order has been successfully updated.',
    type: ApiResponse<null>,
  })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  @ApiBody({
    type: ApiResponse<null>,
  })
  @Post('/:viewId/sort')
  async updateViewRawOrder(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(updateViewOrderRoSchema))
    updateViewOrderRo: IUpdateViewOrderRo
  ): Promise<ApiResponse<null>> {
    await this.viewOpenApiService.updateViewRawOrder(tableId, viewId, updateViewOrderRo);
    return responseWrap(null);
  }
}
