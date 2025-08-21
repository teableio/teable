import { Module } from '@nestjs/common';
import { PrismaModule } from '@teable/db-main-prisma';
import { TableDomainQueryService } from './table-domain-query.service';

/**
 * Module for table domain query functionality
 * This module provides services for fetching and constructing table domain objects
 * specifically for record query operations
 */
@Module({
  imports: [PrismaModule],
  providers: [TableDomainQueryService],
  exports: [TableDomainQueryService],
})
export class TableDomainQueryModule {}
