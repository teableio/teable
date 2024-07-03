import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { IUnPromisify } from '@teable/core';
import { generateWebHookId, generateWebHookRunHistoryId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ContentType,
  ICreateWebhookRo,
  IGetWebhookRunHistoryListQuery,
  IUpdateWebhookRo,
  IWebhookListVo,
  IWebhookRunHistoriesVo,
  IWebhookRunHistoryVo,
  IWebhookVo,
} from '@teable/openapi';
import { WebhookRunStatus } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import type { IClsStore } from '../../types/cls';

@Injectable()
export class WebhookService {
  private logger = new Logger(WebhookService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async getWebhookList(spaceId: string): Promise<IWebhookListVo> {
    const rawWebHookList = await this.prismaService.webhook.findMany({
      select: {
        id: true,
        url: true,
        contentType: true,
        secret: true,
        events: true,
        isEnabled: true,
        createdTime: true,
        lastModifiedTime: true,
      },
      where: {
        spaceId,
      },
    });

    return rawWebHookList.map((item) => this.wrapRawWebhook(item));
  }

  async getWebhookById(webhookId: string): Promise<IWebhookVo> {
    const rawData = await this.prismaService.webhook.findUniqueOrThrow({
      select: {
        id: true,
        url: true,
        contentType: true,
        secret: true,
        events: true,
        isEnabled: true,
        createdTime: true,
        lastModifiedTime: true,
      },
      where: {
        id: webhookId,
      },
    });

    return this.wrapRawWebhook(rawData);
  }

  async getWebhookListBySpaceId(
    spaceId: string
  ): Promise<(IWebhookVo & { secret: string | null })[]> {
    const rawDataList = await this.prismaService.webhook.findMany({
      select: {
        id: true,
        url: true,
        contentType: true,
        secret: true,
        events: true,
        isEnabled: true,
        createdTime: true,
        lastModifiedTime: true,
      },
      where: {
        spaceId,
      },
    });

    return rawDataList.map((item) => {
      return {
        ...this.wrapRawWebhook(item),
        secret: item.secret,
      };
    });
  }

  async createWebhook(body: ICreateWebhookRo): Promise<IWebhookVo> {
    const { spaceId } = body;
    await this.checkWebhookLimit(spaceId);

    const rawWebHook = await this.create(body);
    return this.wrapRawWebhook(rawWebHook);
  }

  async deleteWebhook(webhookId: string) {
    await this.prismaService.webhook.delete({
      where: {
        id: webhookId,
      },
    });
  }

  async updateWebhook(webhookId: string, body: IUpdateWebhookRo): Promise<IWebhookVo> {
    const rawWebHook = await this.update(webhookId, body);
    return this.wrapRawWebhook(rawWebHook);
  }

  async getWebhookRunHistoryList(
    webhookId: string,
    query: IGetWebhookRunHistoryListQuery
  ): Promise<IWebhookRunHistoriesVo> {
    const { cursor } = query;
    const limit = 10;

    const rawDataList = await this.prismaService.webhookRunHistory.findMany({
      where: {
        webhookId,
      },
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: {
        createdTime: 'desc',
      },
    });

    const runHistories = rawDataList.map((v) => {
      return {
        id: v.id,
        webhookId: v.webhookId,
        event: v.event,
        status: v.status,
        request: v.request && JSON.parse(v.request),
        response: v.response && JSON.parse(v.response),
        createdTime: v.createdTime.toISOString(),
        finishedTime: v.finishedTime?.toISOString(),
      };
    });

    let nextCursor: typeof cursor | undefined = undefined;
    if (rawDataList.length > limit) {
      const nextItem = rawDataList.pop();
      nextCursor = nextItem!.id;
    }
    return {
      runHistories,
      nextCursor,
    };
  }

  async getWebhookRunHistoryById(runHistoryId: string): Promise<IWebhookRunHistoryVo> {
    const rawData = await this.prismaService.webhookRunHistory.findUniqueOrThrow({
      where: {
        id: runHistoryId,
      },
    });

    return {
      id: rawData.id,
      webhookId: rawData.webhookId,
      event: rawData.event,
      status: rawData.status,
      request: rawData.request && JSON.parse(rawData.request),
      response: rawData.response && JSON.parse(rawData.response),
      createdTime: rawData.createdTime.toISOString(),
      finishedTime: rawData.finishedTime?.toISOString(),
    };
  }

  async startRunLog(webhookId: string, event: string, request: string) {
    const userId = this.cls.get('user.id');
    const runHistoryId = generateWebHookRunHistoryId();

    await this.prismaService.webhookRunHistory.create({
      data: {
        id: runHistoryId,
        webhookId,
        event: '',
        status: WebhookRunStatus.Running,
        request: '',
        response: '{}',
        createdBy: userId,
        createdTime: new Date().toISOString(),
      },
    });
  }

  async endRunLog(runHistoryId: string, response: string, isError?: boolean, errorMsg?: string) {
    await this.prismaService.webhookRunHistory.update({
      data: {
        status: WebhookRunStatus.Finished,
        response: '',
        isError,
        errorMsg,
        finishedTime: new Date().toISOString(),
      },
      where: {
        id: runHistoryId,
      },
    });
  }

  private wrapRawWebhook(model: IUnPromisify<ReturnType<typeof this.create>>) {
    const { secret, contentType, ...other } = model;

    return {
      ...other,
      contentType: contentType as ContentType,
      events: JSON.parse(other.events!),
      hasSecret: !secret,
      createdTime: other.createdTime?.toISOString(),
      lastModifiedTime: other.lastModifiedTime?.toISOString(),
    };
  }

  private async create(input: ICreateWebhookRo) {
    const { spaceId, baseIds, url, contentType, secret, events, isEnabled } = input;
    const userId = this.cls.get('user.id');
    const webhookId = generateWebHookId();

    return this.prismaService.webhook.create({
      select: {
        id: true,
        url: true,
        contentType: true,
        secret: true,
        events: true,
        isEnabled: true,
        createdTime: true,
        lastModifiedTime: true,
      },
      data: {
        id: webhookId,
        spaceId: spaceId,
        baseIds: baseIds && JSON.stringify(baseIds),
        url: url,
        method: 'POST',
        contentType: contentType.toString(),
        secret: secret,
        events: events && JSON.stringify(events),
        isEnabled: isEnabled,
        createdBy: userId,
      },
    });
  }

  private async update(webhookId: string, input: IUpdateWebhookRo) {
    const { spaceId, baseIds, url, contentType, secret, events, isEnabled } = input;
    const userId = this.cls.get('user.id');

    return this.prismaService.webhook.update({
      select: {
        id: true,
        url: true,
        contentType: true,
        secret: true,
        events: true,
        isEnabled: true,
        createdTime: true,
        lastModifiedTime: true,
      },
      data: {
        spaceId: spaceId,
        baseIds: JSON.stringify(baseIds),
        url: url,
        method: 'POST',
        contentType: contentType,
        secret: secret,
        events: JSON.stringify(events),
        isEnabled: isEnabled,
        createdBy: userId,
      },
      where: {
        id: webhookId,
      },
    });
  }

  private async checkWebhookLimit(spaceId: string) {
    const webhookCount = await this.prismaService.webhook.count({
      where: {
        spaceId,
      },
    });

    const { maxCreateWebhookLimit } = this.thresholdConfig;
    if (webhookCount >= maxCreateWebhookLimit) {
      throw new BadRequestException(
        `Exceed the maximum limit of creating webhooks, the limit is ${maxCreateWebhookLimit}`
      );
    }
  }
}
