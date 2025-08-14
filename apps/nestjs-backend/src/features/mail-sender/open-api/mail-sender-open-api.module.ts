import { Module } from '@nestjs/common';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { MailSenderModule } from '../mail-sender.module';
import { MAIL_SENDER_QUEUE, MailSenderProcessor } from '../mail-sender.processor';
import { MailSenderOpenApiController } from './mail-sender-open-api.controller';
import { MailSenderOpenApiService } from './mail-sender-open-api.service';

@Module({
  imports: [MailSenderModule.register(), EventJobModule.registerQueue(MAIL_SENDER_QUEUE)],
  providers: [MailSenderOpenApiService, MailSenderProcessor],
  exports: [MailSenderOpenApiService, MailSenderProcessor],
  controllers: [MailSenderOpenApiController],
})
export class MailSenderOpenApiModule {}
