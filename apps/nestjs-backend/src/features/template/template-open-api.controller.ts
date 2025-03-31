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
import { Public } from '../auth/decorators/public.decorator';
import { TemplateOpenApiService } from './template-open-api.service';

@Controller('api/template')
export class TemplateOpenApiController {
  constructor(private readonly templateOpenApiService: TemplateOpenApiService) {}

  @Public()
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
  async createTemplate(
    @Body(new ZodValidationPipe(createTemplateRoSchema)) createTemplateRo: ICreateTemplateRo
  ) {
    return this.templateOpenApiService.createTemplate(createTemplateRo);
  }

  @Delete('/:templateId')
  async deleteTemplate(@Param('templateId') templateId: string) {
    return this.templateOpenApiService.deleteTemplate(templateId);
  }

  @Patch('/:templateId')
  async updateTemplate(
    @Param('templateId') templateId: string,
    @Body(new ZodValidationPipe(updateTemplateRoSchema)) updateTemplateRo: IUpdateTemplateRo
  ) {
    return this.templateOpenApiService.updateTemplate(templateId, updateTemplateRo);
  }

  @Patch('/:templateId/pin-top')
  async updateTemplateOrder(@Param('templateId') templateId: string) {
    return this.templateOpenApiService.pinTopTemplate(templateId);
  }

  @Post('/:templateId/snapshot')
  async createTemplateSnapshot(@Param('templateId') templateId: string) {
    return this.templateOpenApiService.createTemplateSnapshot(templateId);
  }

  @Post('/category/create')
  async createTemplateCategory(@Body() createTemplateCategoryRo: ICreateTemplateCategoryRo) {
    return this.templateOpenApiService.createTemplateCategory(createTemplateCategoryRo);
  }

  @Get('/category/list')
  async getTemplateCategoryList() {
    return this.templateOpenApiService.getTemplateCategoryList();
  }

  @Delete('/category/:templateCategoryId')
  async deleteTemplateCategory(@Param('templateCategoryId') templateCategoryId: string) {
    return this.templateOpenApiService.deleteTemplateCategory(templateCategoryId);
  }

  @Patch('/category/:templateCategoryId')
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

  @Patch('/:templateId/usage-count')
  async updateTemplateUsageCount(@Param('templateId') templateId: string) {
    return this.templateOpenApiService.updateTemplateUsageCount(templateId);
  }
}
