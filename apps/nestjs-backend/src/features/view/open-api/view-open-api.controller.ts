import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import type { IViewVo } from '@teable-group/core';
import { viewRoSchema, manualSortRoSchema, IManualSortRo, IViewRo } from '@teable-group/core';
import { ZodValidationPipe } from '../../..//zod.validation.pipe';
import { ViewService } from '../view.service';
import { ViewOpenApiService } from './view-open-api.service';

@Controller('api/table/:tableId/view')
export class ViewOpenApiController {
  constructor(
    private readonly viewService: ViewService,
    private readonly viewOpenApiService: ViewOpenApiService
  ) {}

  @Get(':viewId')
  async getView(
    @Param('tableId') _tableId: string,
    @Param('viewId') viewId: string
  ): Promise<IViewVo> {
    return await this.viewService.getViewById(viewId);
  }

  @Get()
  async getViews(@Param('tableId') tableId: string): Promise<IViewVo[]> {
    return await this.viewService.getViews(tableId);
  }

  @Post()
  async createView(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(viewRoSchema)) viewRo: IViewRo
  ): Promise<IViewVo> {
    return await this.viewOpenApiService.createView(tableId, viewRo);
  }

  @Delete('/:viewId')
  async deleteView(@Param('tableId') tableId: string, @Param('viewId') viewId: string) {
    return await this.viewOpenApiService.deleteView(tableId, viewId);
  }

  @Post('/:viewId/sort')
  async manualSort(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(manualSortRoSchema))
    updateViewOrderRo: IManualSortRo
  ) {
    return await this.viewOpenApiService.manualSort(tableId, viewId, updateViewOrderRo);
  }
}
