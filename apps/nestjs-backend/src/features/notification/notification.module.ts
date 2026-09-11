import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../share-db/share-db.module';
import { MailSenderModule } from '../mail-sender/mail-sender.module';
import { UserModule } from '../user/user.module';
import { FailureAlertService } from './failure-alert.service';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  imports: [ShareDbModule, UserModule, MailSenderModule.register()],
  controllers: [NotificationController],
  providers: [NotificationService, FailureAlertService],
  exports: [NotificationService, FailureAlertService],
})
export class NotificationModule {}
