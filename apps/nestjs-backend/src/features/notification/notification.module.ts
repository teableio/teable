import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../share-db/share-db.module';
import { CoalesceModule } from '../coalesce/coalesce.module';
import { MailSenderModule } from '../mail-sender/mail-sender.module';
import { UserModule } from '../user/user.module';
import { AppNotificationService } from './app-notification.service';
import { FailureAlertService } from './failure-alert.service';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  imports: [CoalesceModule, ShareDbModule, UserModule, MailSenderModule.register()],
  controllers: [NotificationController],
  providers: [NotificationService, FailureAlertService, AppNotificationService],
  exports: [NotificationService, FailureAlertService],
})
export class NotificationModule {}
