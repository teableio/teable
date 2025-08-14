import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import dayjs from 'dayjs';
import { MailSenderService } from './mail-sender.service';

export const MAIL_SENDER_QUEUE = 'mailSenderQueue';

@Processor(MAIL_SENDER_QUEUE)
@Injectable()
export class MailSenderProcessor extends WorkerHost {
  private readonly logger = new Logger(MailSenderProcessor.name);
  constructor(private readonly mailSenderService: MailSenderService) {
    super();
  }

  async process(job: Job) {
    await this.mailSenderService.sendMailFromCache();
    this.logger.log('process at', dayjs().format('YYYY-MM-DD HH:mm:ss'), job.id, job.name);
  }
}
