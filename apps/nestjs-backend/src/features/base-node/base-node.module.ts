import { Module } from '@nestjs/common';
import { DistributedLockModule } from '../../distributed-lock/distributed-lock.module';
import { ShareDbModule } from '../../share-db/share-db.module';
import { BaseNodePermissionGuard } from '../auth/guard/base-node-permission.guard';
import { CanaryModule } from '../canary/canary.module';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { ShortLinkModule } from '../short-link/short-link.module';
import { SpaceDataDbMigrationGuardModule } from '../space/space-data-db-migration-guard.module';
import { TableOpenApiModule } from '../table/open-api/table-open-api.module';
import { TableOpenApiV2Module } from '../table/open-api/table-open-api-v2.module';
import { TableMoveModule } from '../table/table-move.module';
import { BaseDependencyGraphService } from './base-dependency-graph.service';
import { BaseNodeMoveService } from './base-node-move.service';
import { BaseNodeController } from './base-node.controller';
import { BaseNodeListener } from './base-node.listener';
import { BaseNodeService } from './base-node.service';
import { BaseNodeFolderModule } from './folder/base-node-folder.module';
import { FolderDeletePreviewRegistrar } from './folder-delete-preview.service';
import { BASE_NODE_RESOURCE_HANDLERS } from './resource/base-node-resource-handler';
import { BaseNodeResourceHandlerRegistry } from './resource/base-node-resource-handler.registry';
import { COMMUNITY_BASE_NODE_RESOURCE_HANDLERS } from './resource/base-node-resource-handlers';

@Module({
  imports: [
    BaseNodeFolderModule,
    ShareDbModule,
    CanaryModule,
    DashboardModule,
    TableOpenApiModule,
    TableOpenApiV2Module,
    TableMoveModule,
    ShortLinkModule,
    SpaceDataDbMigrationGuardModule,
    CollaboratorModule,
    DistributedLockModule,
  ],
  controllers: [BaseNodeController],
  providers: [
    BaseNodePermissionGuard,
    BaseNodeService,
    ...COMMUNITY_BASE_NODE_RESOURCE_HANDLERS,
    {
      provide: BASE_NODE_RESOURCE_HANDLERS,
      useFactory: (...handlers: unknown[]) => handlers,
      inject: COMMUNITY_BASE_NODE_RESOURCE_HANDLERS,
    },
    BaseNodeResourceHandlerRegistry,
    BaseNodeMoveService,
    BaseDependencyGraphService,
    BaseNodeListener,
    FolderDeletePreviewRegistrar,
  ],
  exports: [
    BaseNodeResourceHandlerRegistry,
    BaseNodePermissionGuard,
    BaseNodeService,
    BaseNodeMoveService,
    BaseDependencyGraphService,
  ],
})
export class BaseNodeModule {}
