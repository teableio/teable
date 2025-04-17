/* eslint-disable sonarjs/no-duplicate-string */
import { Controller, Get, Post, Body, Param, Patch, Delete } from '@nestjs/common';
import {
  createTemplateRoSchema,
  ICreateTemplateCategoryRo,
  ICreateTemplateRo,
  IUpdateTemplateCategoryRo,
  IUpdateTemplateRo,
  updateTemplateCategoryRoSchema,
  updateTemplateRoSchema,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { TemplateOpenApiService } from './template-open-api.service';

@Controller('api/template')
export class TemplateOpenApiController {
  constructor(private readonly templateOpenApiService: TemplateOpenApiService) {}

  @Get()
  async getTemplateList() {
    return this.templateOpenApiService.getAllTemplateList();
  }

  @Public()
  @Get('/published')
  async getPublishedTemplateList() {
    return this.templateOpenApiService.getPublishedTemplateList();
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

  @Public()
  @Get('/category/list/published')
  async getPublishedTemplateCategoryList() {
    return this.templateOpenApiService.getPublishedTemplateCategoryList();
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

  @Public()
  @Get('/:templateId')
  async getTemplateById(@Param('templateId') templateId: string) {
    return this.templateOpenApiService.getTemplateDetailById(templateId);
  }
}
