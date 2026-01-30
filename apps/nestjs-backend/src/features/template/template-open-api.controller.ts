/* eslint-disable sonarjs/no-duplicate-string */
import { Controller, Get, Post, Body, Param, Patch, Delete, Query, Put } from '@nestjs/common';
import {
  createTemplateRoSchema,
  ICreateTemplateCategoryRo,
  ICreateTemplateRo,
  ITemplateListQueryRo,
  ITemplateQueryRoSchema,
  IUpdateTemplateCategoryRo,
  IUpdateTemplateRo,
  IUpdateOrderRo,
  templateListQueryRoSchema,
  templateQueryRoSchema,
  updateTemplateCategoryRoSchema,
  updateTemplateRoSchema,
  updateOrderRoSchema,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { TemplateOpenApiService } from './template-open-api.service';
import { TemplatePermalinkService } from './template-permalink.service';

@Controller('api/template')
export class TemplateOpenApiController {
  constructor(
    private readonly templateOpenApiService: TemplateOpenApiService,
    private readonly templatePermalinkService: TemplatePermalinkService
  ) {}

  @Get()
  @Permissions('instance|update')
  async getTemplateList(
    @Query(new ZodValidationPipe(templateListQueryRoSchema)) query?: ITemplateListQueryRo
  ) {
    return this.templateOpenApiService.getAllTemplateList(query);
  }

  @Public()
  @Get('/published')
  async getPublishedTemplateList(
    @Query(new ZodValidationPipe(templateQueryRoSchema)) templateQuery: ITemplateQueryRoSchema
  ) {
    return this.templateOpenApiService.getPublishedTemplateList(templateQuery);
  }

  @Post('/create')
  @Permissions('instance|update')
  async createTemplate(
    @Body(new ZodValidationPipe(createTemplateRoSchema)) createTemplateRo: ICreateTemplateRo
  ) {
    return this.templateOpenApiService.createTemplate(createTemplateRo);
  }

  @Delete('/:templateId')
  @Permissions('instance|update')
  async deleteTemplate(@Param('templateId') templateId: string) {
    return this.templateOpenApiService.deleteTemplate(templateId);
  }

  @Patch('/:templateId')
  @Permissions('instance|update')
  async updateTemplate(
    @Param('templateId') templateId: string,
    @Body(new ZodValidationPipe(updateTemplateRoSchema)) updateTemplateRo: IUpdateTemplateRo
  ) {
    return this.templateOpenApiService.updateTemplate(templateId, updateTemplateRo);
  }

  @Patch('/:templateId/pin-top')
  @Permissions('instance|update')
  async updateTemplateOrder(@Param('templateId') templateId: string) {
    return this.templateOpenApiService.pinTopTemplate(templateId);
  }

  @Put('/:templateId/order')
  @Permissions('instance|update')
  async updateOrder(
    @Param('templateId') templateId: string,
    @Body(new ZodValidationPipe(updateOrderRoSchema)) updateOrderRo: IUpdateOrderRo
  ) {
    return await this.templateOpenApiService.updateOrder(templateId, updateOrderRo);
  }

  @Post('/:templateId/snapshot')
  @Permissions('instance|update')
  async createTemplateSnapshot(@Param('templateId') templateId: string) {
    return this.templateOpenApiService.createTemplateSnapshot(templateId);
  }

  @Post('/category/create')
  @Permissions('instance|update')
  async createTemplateCategory(@Body() createTemplateCategoryRo: ICreateTemplateCategoryRo) {
    return this.templateOpenApiService.createTemplateCategory(createTemplateCategoryRo);
  }

  @Get('/category/list')
  async getTemplateCategoryList() {
    return this.templateOpenApiService.getTemplateCategoryList();
  }

  @Delete('/category/:templateCategoryId')
  @Permissions('instance|update')
  async deleteTemplateCategory(@Param('templateCategoryId') templateCategoryId: string) {
    return this.templateOpenApiService.deleteTemplateCategory(templateCategoryId);
  }

  @Patch('/category/:templateCategoryId')
  @Permissions('instance|update')
  async updateTemplateCategory(
    @Param('templateCategoryId') templateCategoryId: string,
    @Body(new ZodValidationPipe(updateTemplateCategoryRoSchema))
    updateTemplateCategoryRo: IUpdateTemplateCategoryRo
  ) {
    return this.templateOpenApiService.updateTemplateCategory(
      templateCategoryId,
      updateTemplateCategoryRo
    );
  }

  @Put('/category/:templateCategoryId/order')
  @Permissions('instance|update')
  async updateTemplateCategoryOrder(
    @Param('templateCategoryId') templateCategoryId: string,
    @Body(new ZodValidationPipe(updateOrderRoSchema)) updateOrderRo: IUpdateOrderRo
  ) {
    return await this.templateOpenApiService.updateTemplateCategoryOrder(
      templateCategoryId,
      updateOrderRo
    );
  }

  @Get('/by-base/:baseId')
  async getTemplateByBaseId(@Param('baseId') baseId: string) {
    return this.templateOpenApiService.getTemplateByBaseId(baseId);
  }

  @Delete('/unpublish/:templateId')
  async unpublishTemplate(@Param('templateId') templateId: string) {
    return this.templateOpenApiService.deleteTemplate(templateId);
  }

  @Public()
  @Get('/:templateId')
  async getTemplateById(@Param('templateId') templateId: string) {
    return this.templateOpenApiService.getTemplateDetailById(templateId);
  }

  @Public()
  @Patch('/:templateId/visit')
  async incrementTemplateVisitCount(@Param('templateId') templateId: string) {
    return this.templateOpenApiService.incrementTemplateVisitCount(templateId);
  }

  @Public()
  @Get('/permalink/:identifier')
  async getTemplatePermalink(@Param('identifier') identifier: string) {
    return await this.templatePermalinkService.resolvePermalink(identifier);
  }
}
