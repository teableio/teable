import { Module } from '@nestjs/common';
import { PrismaModule } from '@teable/db-main-prisma';
import { RecordQueryBuilderModule } from '../query-builder/record-query-builder.module';
import { RecordMaterialViewService } from './record-material-view.service';

@Module({
  imports: [RecordQueryBuilderModule, PrismaModule],
  providers: [RecordMaterialViewService],
  exports: [RecordMaterialViewService],
})
export class RecordMaterialViewModule {}
