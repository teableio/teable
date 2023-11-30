import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import multer from 'multer';
import { AttachmentsTableService } from './attachments-table.service';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

@Module({
  providers: [AttachmentsService, AttachmentsTableService],
  controllers: [AttachmentsController],
  imports: [
    MulterModule.register({
      storage: multer.diskStorage({}),
    }),
  ],
  exports: [AttachmentsService, AttachmentsTableService],
})
export class AttachmentsModule {}
