import { Module } from '@nestjs/common';
import { CanaryModule } from '../canary/canary.module';
import { FieldCacheModule } from '../field-cache/field-cache.module';
import { FieldOpenApiV2Module } from '../field/open-api/field-open-api-v2.module';
import { TableDomainQueryModule } from '../table-domain';
import { V2Module } from '../v2/v2.module';
import { ForeignKeyIntegrityService } from './foreign-key.service';
import { IntegrityPrimaryRepairService } from './integrity-primary-repair.service';
import { IntegrityV2Controller } from './integrity-v2.controller';
import { IntegrityV2Service } from './integrity-v2.service';
import { IntegrityController } from './integrity.controller';
import { LinkFieldIntegrityService } from './link-field.service';
import { LinkIntegrityService } from './link-integrity.service';
import { UniqueIndexService } from './unique-index.service';

@Module({
  imports: [FieldCacheModule, FieldOpenApiV2Module, TableDomainQueryModule, V2Module, CanaryModule],
  controllers: [IntegrityController, IntegrityV2Controller],
  providers: [
    ForeignKeyIntegrityService,
    LinkFieldIntegrityService,
    LinkIntegrityService,
    IntegrityPrimaryRepairService,
    IntegrityV2Service,
    UniqueIndexService,
  ],
  exports: [LinkIntegrityService],
})
export class IntegrityModule {}
