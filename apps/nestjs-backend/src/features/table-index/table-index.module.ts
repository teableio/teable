import { Module } from '@nestjs/common';
import { CanaryModule } from '../canary/canary.module';
import { V2Module } from '../v2/v2.module';
import { IndexBuilderPostgres } from './search-index-builder.postgres';
import { TableIndexService } from './table-index.service';

@Module({
  imports: [CanaryModule, V2Module],
  providers: [IndexBuilderPostgres, TableIndexService],
  exports: [IndexBuilderPostgres, TableIndexService],
})
export class TableIndexModule {}
