/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import type {
  IWebhookListVo,
  IWebhookRunHistoriesVo,
  IWebhookRunHistoryVo,
  IWebhookVo,
} from '@teable/openapi';
import {
  createWebhookRoSchema,
  getWebhookRunHistoryListQuerySchema,
  ICreateWebhookRo,
  IGetWebhookRunHistoryListQuery,
  IUpdateWebhookRo,
  updateWebhookRoSchema,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { WebhookService } from './webhook.service';

@Controller('api/:spaceId/webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Get()
  @Permissions('space|create')
  async getWebhookList(@Param('spaceId') spaceId: string): Promise<IWebhookListVo> {
    return await this.webhookService.getWebhookList(spaceId);
  }

  @Get(':webhookId')
  async getWebhookById(@Param('webhookId') webhookId: string): Promise<IWebhookVo> {
    return await this.webhookService.getWebhookById(webhookId);
  }

  @Post()
  async createWebhook(
    @Body(new ZodValidationPipe(createWebhookRoSchema)) body: ICreateWebhookRo
  ): Promise<IWebhookVo> {
    return await this.webhookService.createWebhook(body);
  }

  @Delete(':webhookId')
  async deleteWebhook(@Param('webhookId') webhookId: string) {
    return await this.webhookService.deleteWebhook(webhookId);
  }

  @Put(':webhookId')
  async updateWebhook(
    @Param('webhookId') webhookId: string,
    @Body(new ZodValidationPipe(updateWebhookRoSchema)) body: IUpdateWebhookRo
  ): Promise<IWebhookVo> {
    return await this.webhookService.updateWebhook(webhookId, body);
  }

  @Get(':webhookId/run-history')
  async getWebhookRunHistoryList(
    @Param('webhookId') webhookId: string,
    @Query(new ZodValidationPipe(getWebhookRunHistoryListQuerySchema))
    query: IGetWebhookRunHistoryListQuery
  ): Promise<IWebhookRunHistoriesVo> {
    return await this.webhookService.getWebhookRunHistoryList(webhookId, query);
  }

  @Get('/run-history/:runHistoryId')
  async getWebhookRunHistoryById(
    @Param('runHistoryId') runHistoryId: string
  ): Promise<IWebhookRunHistoryVo> {
    return await this.webhookService.getWebhookRunHistoryById(runHistoryId);
  }
}
