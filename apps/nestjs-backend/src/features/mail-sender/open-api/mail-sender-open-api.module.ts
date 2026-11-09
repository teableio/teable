import { Module } from '@nestjs/common';
import { SettingOpenApiModule } from '../../setting/open-api/setting-open-api.module';
import { MailSenderModule } from '../mail-sender.module';
import { MailSenderOpenApiController } from './mail-sender-open-api.controller';
import { MailSenderOpenApiService } from './mail-sender-open-api.service';

@Module({
  imports: [MailSenderModule.register(), SettingOpenApiModule],
  providers: [MailSenderOpenApiService],
  exports: [MailSenderOpenApiService],
  controllers: [MailSenderOpenApiController],
})
export class MailSenderOpenApiModule {}
