import { Module } from '@nestjs/common';
import { PermissionModule } from '../auth/permission.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { V2DataQueryCandidateService } from './v2-data-query-candidate.service';
import { V2Module } from './v2.module';

@Module({
  imports: [V2Module, FieldOpenApiModule, PermissionModule],
  providers: [V2DataQueryCandidateService],
  exports: [V2DataQueryCandidateService],
})
export class V2DataQueryCandidateModule {}
