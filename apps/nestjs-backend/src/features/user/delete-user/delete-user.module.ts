import { Module } from '@nestjs/common';
import { StorageModule } from '../../attachments/plugins/storage.module';
import { SessionStoreService } from '../../auth/session/session-store.service';
import { DeleteUserService } from './delete-user.service';

@Module({
  imports: [StorageModule],
  providers: [DeleteUserService, SessionStoreService],
  exports: [DeleteUserService],
})
export class DeleteUserModule {}
