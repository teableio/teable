import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ISendMailOptions } from '@nestjs-modules/mailer';
import { MailTransporterType, MailType } from '@teable/openapi';
import { type Job, type Queue } from 'bullmq';
import dayjs from 'dayjs';
import { CacheService } from '../../../cache/cache.service';
import type { ICacheStore } from '../../../cache/types';
import { Events } from '../../../event-emitter/events';
import { SettingOpenApiService } from '../../setting/open-api/setting-open-api.service';
import { MailSenderService } from '../mail-sender.service';

export const MAIL_SENDER_QUEUE = 'mailSenderQueue';

enum MailSenderJob {
  NotifyMailMerge = 'notifyMailMerge',
  NotifyMailMergeSend = 'notifyMailMergeSend',
}

interface IMailSenderMergeJob {
  payload: ISendMailOptions & { mailType: MailType };
}

@Processor(MAIL_SENDER_QUEUE)
@Injectable()
export class MailSenderMergeProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(MailSenderMergeProcessor.name);
  private readonly notifyMailMergeKey = 'mail-sender:notify-mail-merge:list';
  private readonly notifyMailMergeTime = 'mail-sender:notify-mail-merge:time';
  constructor(
    private readonly mailSenderService: MailSenderService,
    private readonly cacheService: CacheService<ICacheStore>,
    private readonly settingOpenApiService: SettingOpenApiService,
    @InjectQueue(MAIL_SENDER_QUEUE)
    public readonly queue: Queue<IMailSenderMergeJob | null>
  ) {
    super();
  }

  async onModuleInit() {
    const startTime = await this.cacheService.get(this.notifyMailMergeTime);
    if (startTime) {
      await this.cacheService.del(this.notifyMailMergeTime);
      await this.sendNotifyMailMerge();
    }
  }

  async process(job: Job<IMailSenderMergeJob | null>) {
    if (job.name === MailSenderJob.NotifyMailMergeSend) {
      await this.cacheService.del(this.notifyMailMergeTime);
      await this.sendNotifyMailMerge();
      return;
    }
    if (!job.data) {
      return;
    }
    const { payload } = job.data;
    if (job.name === MailSenderJob.NotifyMailMerge) {
      await this.notifyMailMerge(payload);
      const shouldSend = await this.checkAndSetTime();
      if (shouldSend) {
        await this.sendNotifyMailMerge();
      }
    }
  }

  @OnEvent(Events.NOTIFY_MAIL_MERGE)
  async onNotifyMailMerge(event: { payload: ISendMailOptions & { mailType: MailType } }) {
    await this.queue.add(MailSenderJob.NotifyMailMerge, {
      payload: event.payload,
    });
  }

  async checkAndSetTime() {
    const startTime = await this.cacheService.get(this.notifyMailMergeTime);
    if (!startTime) {
      const current = dayjs().valueOf();
      await this.cacheService.set(this.notifyMailMergeTime, current);
      await this.queue.add(MailSenderJob.NotifyMailMergeSend, null, { delay: 1000 * 60 });
      return true;
    }
    return false;
  }

  async notifyMailMerge(mailOptions: ISendMailOptions & { mailType: MailType }) {
    const { to } = mailOptions;
    if (!to || typeof to !== 'string') {
      return;
    }
    const obj = (await this.cacheService.get(this.notifyMailMergeKey)) || {};
    obj[to] = [...(obj[to] || []), mailOptions];
    await this.cacheService.set(this.notifyMailMergeKey, obj);
  }

  async sendNotifyMailMerge() {
    const obj = await this.cacheService.get(this.notifyMailMergeKey);
    await this.cacheService.del(this.notifyMailMergeKey);

    if (!obj || Object.keys(obj).length === 0) {
      return;
    }

    const { brandName } = await this.settingOpenApiService.getServerBrand();
    for (const to in obj) {
      const list = obj[to];
      if (list.length === 0) {
        continue;
      }

      if (list.length === 1) {
        this.mailSenderService.sendMailByTransporterName(
          {
            to,
            ...list[0],
          },
          MailTransporterType.Notify,
          MailType.NotifyMerge
        );
        continue;
      }

      const mailOptions = await this.mailSenderService.notifyMergeOptions(list, brandName);
      this.mailSenderService.sendMailByTransporterName(
        {
          to,
          ...mailOptions,
        },
        MailTransporterType.Notify,
        MailType.NotifyMerge
      );
    }
  }
}
