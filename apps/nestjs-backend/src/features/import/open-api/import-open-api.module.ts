import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { FieldOpenApiModule } from '../../field/open-api/field-open-api.module';
import { NotificationModule } from '../../notification/notification.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { TableOpenApiModule } from '../../table/open-api/table-open-api.module';
import { ImportCsvChunkModule } from './import-csv-chunk.module';
import { ImportController } from './import-open-api.controller';
import { ImportOpenApiService } from './import-open-api.service';

@Module({
  imports: [
    TableOpenApiModule,
    RecordOpenApiModule,
    NotificationModule,
    ShareDbModule,
    ImportCsvChunkModule,
    FieldOpenApiModule,
  ],
  controllers: [ImportController],
  providers: [ImportOpenApiService],
  exports: [ImportOpenApiService],
})
export class ImportOpenApiModule {}
