import { Module } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { FieldOpenApiModule } from '../../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { ViewOpenApiModule } from '../../view/open-api/view-open-api.module';
import { TableModule } from '../table.module';
import { TableController } from './table-open-api.controller';
import { TableOpenApiService } from './table-open-api.service';

@Module({
  imports: [FieldOpenApiModule, RecordOpenApiModule, ViewOpenApiModule, TableModule, ShareDbModule],
  controllers: [TableController],
  providers: [PrismaService, TableOpenApiService],
})
export class TableOpenApiModule {}
