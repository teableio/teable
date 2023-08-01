import { Module } from '@nestjs/common';
import { MailSenderService } from './mail-sender.service';

@Module({
  providers: [MailSenderService],
  exports: [MailSenderService],
})
export class MailSenderModule {}
