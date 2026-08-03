import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { CanaryModule } from '../../canary/canary.module';
import { FieldCalculateModule } from '../../field/field-calculate/field-calculate.module';
import { FieldModule } from '../../field/field.module';
import { RecordModule } from '../../record/record.module';
import { TableDomainQueryModule } from '../../table-domain';
import { V2Module } from '../../v2/v2.module';
import { ViewModule } from '../view.module';
import { ViewOpenApiV2Service } from './view-open-api-v2.service';
import { ViewOpenApiController } from './view-open-api.controller';
import { ViewOpenApiService } from './view-open-api.service';

@Module({
  imports: [
    ViewModule,
    ShareDbModule,
    RecordModule,
    FieldModule,
    FieldCalculateModule,
    TableDomainQueryModule,
    V2Module,
    CanaryModule,
  ],
  controllers: [ViewOpenApiController],
  providers: [ViewOpenApiService, ViewOpenApiV2Service],
  exports: [ViewOpenApiService, ViewOpenApiV2Service],
})
export class ViewOpenApiModule {}
