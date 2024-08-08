import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { FieldModule } from '../field/field.module';
import { TableModule } from '../table/table.module';
import { BaseDuplicateService } from './base-duplicate.service';
import { BaseQueryService } from './base-query/base-query.service';
import { BaseController } from './base.controller';
import { BaseService } from './base.service';
import { DbConnectionService } from './db-connection.service';

@Module({
  controllers: [BaseController],
  imports: [CollaboratorModule, FieldModule, TableModule],
  providers: [DbProvider, BaseService, DbConnectionService, BaseDuplicateService, BaseQueryService],
  exports: [BaseService, DbConnectionService, BaseDuplicateService],
})
export class BaseModule {}
