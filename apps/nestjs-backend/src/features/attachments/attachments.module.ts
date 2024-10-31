import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ShareAuthModule } from '../share/share-auth.module';
import { AttachmentsCropModule } from './attachments-crop.module';
import { AttachmentsStorageModule } from './attachments-storage.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { DynamicAuthGuardFactory } from './guard/auth.guard';
import { StorageModule } from './plugins/storage.module';

@Module({
  providers: [AttachmentsService, DynamicAuthGuardFactory],
  controllers: [AttachmentsController],
  imports: [
    StorageModule,
    AttachmentsStorageModule,
    ShareAuthModule,
    AuthModule,
    AttachmentsCropModule,
  ],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
