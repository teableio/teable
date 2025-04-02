import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../share-db/share-db.module';
import { MailSenderModule } from '../mail-sender/mail-sender.module';
import { UserModule } from '../user/user.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  imports: [ShareDbModule, UserModule, MailSenderModule.register()],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
