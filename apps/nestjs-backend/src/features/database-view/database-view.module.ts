import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { RecordQueryBuilderModule } from '../record/query-builder';
import { TableDomainQueryModule } from '../table-domain';
import { DatabaseViewListener } from './database-view.listener';
import { DatabaseViewService } from './database-view.service';

@Module({
  imports: [RecordQueryBuilderModule, TableDomainQueryModule],
  providers: [DbProvider, DatabaseViewService, DatabaseViewListener],
  exports: [DatabaseViewService],
})
export class DatabaseViewModule {}
