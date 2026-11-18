import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MailTransporterType, MailType } from '@teable/openapi';
import { omit } from 'lodash';
import ms from 'ms';
import { Events } from '../../../event-emitter/events';
import { CoalesceMode, CoalesceService } from '../../coalesce/coalesce.service';
import { SettingOpenApiService } from '../../setting/open-api/setting-open-api.service';
import { MailMergeGroup, type ISendMailOptions } from '../mail-helpers';
import { MailSenderService } from '../mail-sender.service';

// Only a mail that names its group is handed here (MailSenderService.sendMailByTransporterName)
type IMailSenderMergePayload = Omit<ISendMailOptions, 'to' | 'mergeGroup'> & {
  mailType: MailType;
  to: string;
  mergeGroup: MailMergeGroup;
};

/** How long a group's window stays open after the mail that opened it went out at once. */
const MERGE_GROUP_WINDOW_MS: Record<MailMergeGroup, number> = {
  [MailMergeGroup.Default]: ms('1m'),
  [MailMergeGroup.FailureAlert]: ms('1h'),
};

const mergeScope = (group: MailMergeGroup) => `mail-merge:${group}`;

/**
 * Merges notify mails per recipient and group, on a fixed window: the first mail goes out at
 * once, the rest arrive as one mail once the window closes.
 */
@Injectable()
export class MailSenderMergeService {
  private readonly logger = new Logger(MailSenderMergeService.name);

  constructor(
    private readonly mailSenderService: MailSenderService,
    private readonly settingOpenApiService: SettingOpenApiService,
    private readonly coalesceService: CoalesceService
  ) {
    for (const group of Object.values(MailMergeGroup)) {
      this.coalesceService.onFlush<IMailSenderMergePayload>(mergeScope(group), (to, list) =>
        this.deliver(to, list)
      );
    }
  }

  // Reached by event: MailSenderService hands a mail here without depending on this service
  @OnEvent(Events.NOTIFY_MAIL_MERGE)
  async onNotifyMailMerge(event: { payload: IMailSenderMergePayload }) {
    const { payload } = event;
    const group = payload.mergeGroup;
    try {
      const opened = await this.coalesceService.add(mergeScope(group), payload.to, payload, {
        mode: CoalesceMode.Fixed,
        windowMs: MERGE_GROUP_WINDOW_MS[group],
      });
      if (opened) {
        await this.send(payload);
      }
    } catch (error) {
      this.logger.error(`notify mail to merge group ${group} not sent: ${String(error)}`);
    }
  }

  private async deliver(to: string, list: IMailSenderMergePayload[]) {
    if (list.length === 1) {
      await this.send(list[0]);
      return;
    }

    const { brandName, brandLogo } = await this.settingOpenApiService.getServerBrand();
    const mailOptions = await this.mailSenderService.notifyMergeOptions(list, brandName, brandLogo);
    await this.send({ ...mailOptions, to });
  }

  /** Straight to the transport: without its merge group the mail is not merged again. */
  private async send(mail: ISendMailOptions) {
    await this.mailSenderService.sendMailByTransporterName(
      omit(mail, 'mergeGroup'),
      MailTransporterType.Notify,
      MailType.NotifyMerge
    );
  }
}
