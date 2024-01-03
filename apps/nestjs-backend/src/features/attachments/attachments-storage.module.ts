import { Module } from '@nestjs/common';
import { AttachmentsStorageService } from './attachments-storage.service';
import { StorageModule } from './plugins/storage.module';

@Module({
  providers: [AttachmentsStorageService],
  controllers: [],
  imports: [StorageModule],
  exports: [AttachmentsStorageService],
})
export class AttachmentsStorageModule {}
