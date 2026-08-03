import { Module } from '@nestjs/common';
import { PrismaModule } from '@teable/db-main-prisma';
import { DbProvider } from '../../../db-provider/db.provider';
import { TableDomainQueryModule } from '../../table-domain/table-domain-query.module';
import { RecordQueryDialectProvider } from './record-query-builder.provider';
import { RecordQueryBuilderService } from './record-query-builder.service';
import { RECORD_QUERY_BUILDER_SYMBOL } from './record-query-builder.symbol';

/**
 * Module for record query builder functionality
 * This module provides services for building table record queries
 */
@Module({
  imports: [PrismaModule, TableDomainQueryModule],
  providers: [
    DbProvider,
    RecordQueryDialectProvider,
    {
      provide: RECORD_QUERY_BUILDER_SYMBOL,
      useClass: RecordQueryBuilderService,
    },
  ],
  exports: [RECORD_QUERY_BUILDER_SYMBOL],
})
export class RecordQueryBuilderModule {}
