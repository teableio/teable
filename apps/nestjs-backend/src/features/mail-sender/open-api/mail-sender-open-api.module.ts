import { Module } from '@nestjs/common';
import { MailSenderModule } from '../mail-sender.module';
import { MailSenderOpenApiController } from './mail-sender-open-api.controller';
import { MailSenderOpenApiService } from './mail-sender-open-api.service';

@Module({
  imports: [MailSenderModule.register()],
  providers: [MailSenderOpenApiService],
  exports: [MailSenderOpenApiService],
  controllers: [MailSenderOpenApiController],
})
export class MailSenderOpenApiModule {}
