import { Module } from '@nestjs/common';
import { PermissionModule } from '../auth/permission.module';
import { FieldOpenApiV2Module } from '../field/open-api/field-open-api-v2.module';
import { V2DataQueryCandidateService } from './v2-data-query-candidate.service';
import { V2Module } from './v2.module';

@Module({
  imports: [V2Module, FieldOpenApiV2Module, PermissionModule],
  providers: [V2DataQueryCandidateService],
  exports: [V2DataQueryCandidateService],
})
export class V2DataQueryCandidateModule {}
