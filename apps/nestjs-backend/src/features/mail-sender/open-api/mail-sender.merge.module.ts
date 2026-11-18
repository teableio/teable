import { Module } from '@nestjs/common';
import { CoalesceModule } from '../../coalesce/coalesce.module';
import { SettingOpenApiModule } from '../../setting/open-api/setting-open-api.module';
import { MailSenderModule } from '../mail-sender.module';
import { MailSenderMergeService } from './mail-sender.merge.service';

@Module({
  imports: [CoalesceModule, MailSenderModule.register(), SettingOpenApiModule],
  providers: [MailSenderMergeService],
  exports: [MailSenderMergeService],
})
export class MailSenderMergeModule {}
