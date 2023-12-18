import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../share-db/share-db.module';
import { UserModule } from '../user/user.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  imports: [ShareDbModule, UserModule],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
