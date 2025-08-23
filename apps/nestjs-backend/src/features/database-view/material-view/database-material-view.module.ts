import { Module } from '@nestjs/common';
import { PrismaModule } from '@teable/db-main-prisma';
import { RecordQueryBuilderModule } from '../../record/query-builder/record-query-builder.module';
import { DatabaseMaterialViewService } from './database-material-view.service';

@Module({
  imports: [RecordQueryBuilderModule, PrismaModule],
  providers: [DatabaseMaterialViewService],
  exports: [DatabaseMaterialViewService],
})
export class DatabaseMaterialViewModule {}
