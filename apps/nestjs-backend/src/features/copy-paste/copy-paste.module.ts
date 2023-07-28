import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ShareDbModule } from '../../share-db/share-db.module';
import { FieldModule } from '../field/field.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { CopyPasteController } from './copy-paste.controller';
import { CopyPasteService } from './copy-paste.service';

@Module({
  providers: [CopyPasteService, PrismaService],
  controllers: [CopyPasteController],
  imports: [RecordModule, FieldModule, ShareDbModule, RecordOpenApiModule, FieldOpenApiModule],
  exports: [CopyPasteService],
})
export class CopyPasteModule {}
