import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { MailType } from '@teable/openapi';
import { type Queue } from 'bullmq';
import { type ISendMailOptions } from '../mail-helpers';

export const MAIL_SENDER_QUEUE = 'mailSenderQueue';

export type IMailSenderMergePayload = Omit<ISendMailOptions, 'to'> & {
  mailType: MailType;
  to: string;
};
export type INotifyMailMergeSendPayload = { to: string };

export interface IMailSenderMergeJob {
  payload: IMailSenderMergePayload | INotifyMailMergeSendPayload;
}

@Injectable()
export class MailSenderMergeJob {
  constructor(
    @InjectQueue(MAIL_SENDER_QUEUE)
    public readonly queue: Queue<IMailSenderMergeJob>
  ) {}
}
