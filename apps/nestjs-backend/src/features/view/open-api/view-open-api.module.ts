import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { FieldModule } from '../../field/field.module';
import { RecordModule } from '../../record/record.module';
import { ViewModule } from '../view.module';
import { ViewOpenApiController } from './view-open-api.controller';
import { ViewOpenApiService } from './view-open-api.service';

@Module({
  imports: [ViewModule, ShareDbModule, RecordModule, FieldModule],
  controllers: [ViewOpenApiController],
  providers: [ViewOpenApiService],
  exports: [ViewOpenApiService],
})
export class ViewOpenApiModule {}
