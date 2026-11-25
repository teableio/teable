import { Module } from '@nestjs/common';
import { SHAREDB_NATIVE_FIELD_SNAPSHOT_READER } from '../../../share-db/interface';
import { FieldCacheModule } from '../../field-cache/field-cache.module';
import { FieldPeriodicRefreshModule } from '../../field-periodic-refresh/field-periodic-refresh.module';
import { FieldReferenceAdmissionModule } from '../../field-reference-admission/field-reference-admission.module';
import { TableIndexModule } from '../../table-index/table-index.module';
import { V2Module } from '../../v2/v2.module';
import { FieldDependencyReadService } from './field-dependency-read.service';
import { FieldOpenApiV2Service } from './field-open-api-v2.service';

@Module({
  imports: [
    FieldPeriodicRefreshModule,
    FieldCacheModule,
    FieldReferenceAdmissionModule,
    TableIndexModule,
    V2Module,
  ],
  providers: [
    FieldOpenApiV2Service,
    FieldDependencyReadService,
    { provide: SHAREDB_NATIVE_FIELD_SNAPSHOT_READER, useExisting: FieldOpenApiV2Service },
  ],
  exports: [
    FieldOpenApiV2Service,
    FieldDependencyReadService,
    SHAREDB_NATIVE_FIELD_SNAPSHOT_READER,
  ],
})
export class FieldOpenApiV2Module {}
