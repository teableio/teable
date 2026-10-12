import { Module } from '@nestjs/common';
import { DistributedLockModule } from '../../distributed-lock';
import { ShareDbModule } from '../../share-db/share-db.module';
import { MailSenderModule } from '../mail-sender/mail-sender.module';
import { UserModule } from '../user/user.module';
import { AppNotificationService } from './app-notification.service';
import { FailureAlertService } from './failure-alert.service';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  imports: [DistributedLockModule, ShareDbModule, UserModule, MailSenderModule.register()],
  controllers: [NotificationController],
  providers: [NotificationService, FailureAlertService, AppNotificationService],
  exports: [NotificationService, FailureAlertService],
})
export class NotificationModule {}
