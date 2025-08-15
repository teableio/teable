import { Module } from '@nestjs/common';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { SettingOpenApiModule } from '../../setting/open-api/setting-open-api.module';
import { MailSenderModule } from '../mail-sender.module';
import { MAIL_SENDER_QUEUE, MailSenderMergeProcessor } from './mail-sender.merge.processor';

@Module({
  imports: [
    MailSenderModule.register(),
    EventJobModule.registerQueue(MAIL_SENDER_QUEUE),
    SettingOpenApiModule,
  ],
  providers: [MailSenderMergeProcessor],
  exports: [MailSenderMergeProcessor],
})
export class MailSenderMergeModule {}
