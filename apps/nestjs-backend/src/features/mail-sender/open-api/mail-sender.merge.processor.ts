import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MailTransporterType, MailType } from '@teable/openapi';
import { type Job } from 'bullmq';
import { isUndefined } from 'lodash';
import { CacheService } from '../../../cache/cache.service';
import type { ICacheStore } from '../../../cache/types';
import { Events } from '../../../event-emitter/events';
import { SettingOpenApiService } from '../../setting/open-api/setting-open-api.service';
import { MailSenderService } from '../mail-sender.service';
import type {
  IMailSenderMergeJob,
  INotifyMailMergeSendPayload,
  IMailSenderMergePayload,
} from './mail-sender.merge.job';
import { MAIL_SENDER_QUEUE, MailSenderMergeJob } from './mail-sender.merge.job';

enum MailSenderJob {
  NotifyMailMerge = 'notifyMailMerge',
  NotifyMailMergeSend = 'notifyMailMergeSend',
}

@Processor(MAIL_SENDER_QUEUE)
@Injectable()
export class MailSenderMergeProcessor extends WorkerHost {
  constructor(
    private readonly mailSenderService: MailSenderService,
    private readonly cacheService: CacheService<ICacheStore>,
    private readonly settingOpenApiService: SettingOpenApiService,
    private readonly mailSenderMergeJob: MailSenderMergeJob
  ) {
    super();
  }

  async process(job: Job<IMailSenderMergeJob>) {
    if (!job.data) {
      return;
    }
    const { payload } = job.data;

    if (job.name === MailSenderJob.NotifyMailMergeSend) {
      await this.sendNotifyMailMerge(payload as INotifyMailMergeSendPayload);
      return;
    }

    if (job.name === MailSenderJob.NotifyMailMerge) {
      const shouldSend = await this.checkAndMerge(payload as IMailSenderMergePayload);
      if (shouldSend) {
        this.mailSenderService.sendMailByTransporterName(
          payload,
          MailTransporterType.Notify,
          MailType.NotifyMerge
        );
      }
    }
  }

  @OnEvent(Events.NOTIFY_MAIL_MERGE)
  async onNotifyMailMerge(event: { payload: IMailSenderMergePayload }) {
    await this.mailSenderMergeJob.queue.add(MailSenderJob.NotifyMailMerge, {
      payload: event.payload,
    });
  }

  private async checkAndMerge(payload: IMailSenderMergePayload) {
    const { to } = payload;
    const list = await this.cacheService.get(`mail-sender:notify-mail-merge:${to}`);
    if (isUndefined(list)) {
      await this.cacheService.set(`mail-sender:notify-mail-merge:${to}`, [], 1000 * 60 * 5); // 5 minutes
      await this.mailSenderMergeJob.queue.add(
        MailSenderJob.NotifyMailMergeSend,
        {
          payload: { to },
        },
        { delay: 1000 * 60 } // 1 minute
      );
      return true;
    }
    await this.cacheService.set(`mail-sender:notify-mail-merge:${to}`, [...list, payload]);
    return false;
  }

  private async sendNotifyMailMerge(payload: INotifyMailMergeSendPayload) {
    const { to } = payload;
    const list = await this.cacheService.get(`mail-sender:notify-mail-merge:${to}`);
    await this.cacheService.del(`mail-sender:notify-mail-merge:${to}`);

    if (!list || list.length === 0) {
      return;
    }

    if (list.length === 1) {
      this.mailSenderService.sendMailByTransporterName(
        list[0],
        MailTransporterType.Notify,
        MailType.NotifyMerge
      );
      return;
    }

    const { brandName } = await this.settingOpenApiService.getServerBrand();
    const mailOptions = await this.mailSenderService.notifyMergeOptions(list, brandName);
    this.mailSenderService.sendMailByTransporterName(
      {
        ...mailOptions,
        to,
      },
      MailTransporterType.Notify,
      MailType.NotifyMerge
    );
  }
}
