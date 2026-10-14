import { Module } from '@nestjs/common';
import { DistributedLockModule } from '../../distributed-lock/distributed-lock.module';
import { ShareDbModule } from '../../share-db/share-db.module';
import { BaseNodePermissionGuard } from '../auth/guard/base-node-permission.guard';
import { CanaryModule } from '../canary/canary.module';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { FieldDuplicateModule } from '../field/field-duplicate/field-duplicate.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { ShortLinkModule } from '../short-link/short-link.module';
import { SpaceDataDbMigrationGuardModule } from '../space/space-data-db-migration-guard.module';
import { TableOpenApiModule } from '../table/open-api/table-open-api.module';
import { TableModule } from '../table/table.module';
import { BaseDependencyGraphService } from './base-dependency-graph.service';
import { BaseNodeMoveService } from './base-node-move.service';
import { BaseNodeController } from './base-node.controller';
import { BaseNodeListener } from './base-node.listener';
import { BaseNodeService } from './base-node.service';
import { BaseNodeFolderModule } from './folder/base-node-folder.module';

@Module({
  imports: [
    BaseNodeFolderModule,
    ShareDbModule,
    CanaryModule,
    DashboardModule,
    TableOpenApiModule,
    TableModule,
    FieldOpenApiModule,
    FieldDuplicateModule,
    ShortLinkModule,
    SpaceDataDbMigrationGuardModule,
    CollaboratorModule,
    DistributedLockModule,
  ],
  controllers: [BaseNodeController],
  providers: [
    BaseNodePermissionGuard,
    BaseNodeService,
    BaseNodeMoveService,
    BaseDependencyGraphService,
    BaseNodeListener,
  ],
  exports: [
    BaseNodePermissionGuard,
    BaseNodeService,
    BaseNodeMoveService,
    BaseDependencyGraphService,
  ],
})
export class BaseNodeModule {}
