import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { RawOpStagingModule } from '../../share-db/raw-op-staging.module';
import { RecordQueryBuilderModule } from '../record/query-builder';
import { RecordQueryService } from '../record/record-query.service';
import { RecordActorStorageModule } from '../record-attribution/record-actor-storage.module';
import { TableDomainQueryModule } from '../table-domain';
import { BatchService } from './batch.service';
import { FieldCalculationService } from './field-calculation.service';
import { LinkService } from './link.service';
import { ReferenceService } from './reference.service';
import { SystemFieldService } from './system-field.service';

@Module({
  imports: [
    RawOpStagingModule,
    RecordQueryBuilderModule,
    TableDomainQueryModule,
    RecordActorStorageModule,
  ],
  providers: [
    DbProvider,
    RecordQueryService,
    BatchService,
    ReferenceService,
    LinkService,
    FieldCalculationService,
    SystemFieldService,
  ],
  exports: [
    BatchService,
    ReferenceService,
    LinkService,
    FieldCalculationService,
    SystemFieldService,
    RecordQueryService,
  ],
})
export class CalculationModule {}
