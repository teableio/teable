import { Module } from '@nestjs/common';
import { DbProvider } from '../../../db-provider/db.provider';
import { FieldOpenApiV2Module } from '../../field/open-api/field-open-api-v2.module';
import { V2Module } from '../../v2/v2.module';
import { BaseQueryService } from './base-query.service';

@Module({
  imports: [FieldOpenApiV2Module, V2Module],
  providers: [DbProvider, BaseQueryService],
  exports: [BaseQueryService],
})
export class BaseQueryModule {}
