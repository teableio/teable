import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { RecordModule } from '../record.module';
import { RecordOpenApiController } from './record-open-api.controller';
import { RecordOpenApiService } from './record-open-api.service';

@Module({
  imports: [RecordModule, ShareDbModule],
  controllers: [RecordOpenApiController],
  providers: [RecordOpenApiService],
})
export class RecordOpenApiModule {}
