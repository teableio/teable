import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { FieldCalculateModule } from '../../field/field-calculate/field-calculate.module';
import { FieldModule } from '../../field/field.module';
import { RecordModule } from '../../record/record.module';
import { ViewModule } from '../view.module';
import { ViewOpenApiController } from './view-open-api.controller';
import { ViewOpenApiService } from './view-open-api.service';

@Module({
  imports: [ViewModule, ShareDbModule, RecordModule, FieldModule, FieldCalculateModule],
  controllers: [ViewOpenApiController],
  providers: [ViewOpenApiService],
  exports: [ViewOpenApiService],
})
export class ViewOpenApiModule {}
