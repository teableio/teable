import { Module } from '@nestjs/common';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { conditionalQueueProcessorProviders } from '../../../utils/queue';
import { SettingOpenApiModule } from '../../setting/open-api/setting-open-api.module';
import { MailSenderModule } from '../mail-sender.module';
import { MAIL_SENDER_QUEUE, MailSenderMergeJob } from './mail-sender.merge.job';
import { MailSenderMergeProcessor } from './mail-sender.merge.processor';

@Module({
  imports: [
    MailSenderModule.register(),
    EventJobModule.registerQueue(MAIL_SENDER_QUEUE),
    SettingOpenApiModule,
  ],
  providers: [...conditionalQueueProcessorProviders(MailSenderMergeProcessor), MailSenderMergeJob],
  exports: [MailSenderMergeJob],
})
export class MailSenderMergeModule {}
