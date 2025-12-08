import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../share-db/share-db.module';
import { BaseNodePermissionGuard } from '../auth/guard/base-node-permission.guard';
import { DashboardModule } from '../dashboard/dashboard.module';
import { FieldDuplicateModule } from '../field/field-duplicate/field-duplicate.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { TableOpenApiModule } from '../table/open-api/table-open-api.module';
import { TableDuplicateService } from '../table/table-duplicate.service';
import { TableModule } from '../table/table.module';
import { BaseNodeController } from './base-node.controller';
import { BaseNodeService } from './base-node.service';
import { BaseNodeFolderModule } from './folder/base-node-folder.module';

@Module({
  imports: [
    BaseNodeFolderModule,
    ShareDbModule,
    DashboardModule,
    TableOpenApiModule,
    TableModule,
    FieldOpenApiModule,
    FieldDuplicateModule,
  ],
  controllers: [BaseNodeController],
  providers: [BaseNodeService, TableDuplicateService, BaseNodePermissionGuard],
  exports: [BaseNodeService, BaseNodePermissionGuard],
})
export class BaseNodeModule {}
