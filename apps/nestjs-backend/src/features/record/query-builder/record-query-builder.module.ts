import { Module } from '@nestjs/common';
import { PrismaModule } from '@teable/db-main-prisma';
import { DbProvider } from '../../../db-provider/db.provider';
import { RecordQueryBuilderService } from './record-query-builder.service';
import { RECORD_QUERY_BUILDER_SYMBOL } from './record-query-builder.symbol';

/**
 * Module for record query builder functionality
 * This module provides services for building table record queries
 */
@Module({
  imports: [PrismaModule],
  providers: [
    DbProvider,
    {
      provide: RECORD_QUERY_BUILDER_SYMBOL,
      useClass: RecordQueryBuilderService,
    },
  ],
  exports: [RECORD_QUERY_BUILDER_SYMBOL],
})
export class RecordQueryBuilderModule {}
