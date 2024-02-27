import { Module } from '@nestjs/common';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { TableOpenApiModule } from '../../table/open-api/table-open-api.module';
import { ImportController } from './import-open-api.controller';
import { ImportOpenApiService } from './import-open-api.service';

@Module({
  imports: [TableOpenApiModule, RecordOpenApiModule],
  controllers: [ImportController],
  providers: [ImportOpenApiService],
  exports: [ImportOpenApiService],
})
export class ImportOpenApiModule {}
