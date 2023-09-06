import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import type { IViewVo } from '@teable-group/core';
import { viewRoSchema } from '@teable-group/core';
import { ZodValidationPipe } from '../../..//zod.validation.pipe';
import { IViewInstance } from '../model/factory';
import { ViewService } from '../view.service';
import { ViewOpenApiService } from './view-open-api.service';
import { ViewPipe } from './view.pipe';

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
    @Body(new ZodValidationPipe(viewRoSchema), ViewPipe) viewInstance: IViewInstance
  ): Promise<IViewVo> {
    return await this.viewOpenApiService.createView(tableId, viewInstance);
  }

  @Delete('/:viewId')
  async deleteView(@Param('tableId') tableId: string, @Param('viewId') viewId: string) {
    return await this.viewOpenApiService.deleteView(tableId, viewId);
  }
}
