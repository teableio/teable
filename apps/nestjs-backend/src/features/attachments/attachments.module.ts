import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import multer from 'multer';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

@Module({
  providers: [AttachmentsService],
  controllers: [AttachmentsController],
  imports: [
    MulterModule.register({
      storage: multer.diskStorage({}),
    }),
  ],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
