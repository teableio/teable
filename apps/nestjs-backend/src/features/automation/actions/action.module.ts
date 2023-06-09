import { Module } from '@nestjs/common';
import { MailSenderModule } from '../../mail-sender/mail-sender.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { MailSender } from './mail-sender';
import { CreateRecord, UpdateRecord } from './records';
import { Webhook } from './webhook';

@Module({
  imports: [MailSenderModule, RecordOpenApiModule],
  providers: [Webhook, MailSender, CreateRecord, UpdateRecord],
  exports: [Webhook, MailSender, CreateRecord, UpdateRecord],
})
export class ActionModule {}
