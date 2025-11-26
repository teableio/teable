import { Global, Module } from '@nestjs/common';
import { BaseNodePermissionGuard } from './guard/base-node-permission.guard';
import { PermissionGuard } from './guard/permission.guard';
import { PermissionService } from './permission.service';

@Global()
@Module({
  providers: [PermissionService, PermissionGuard, BaseNodePermissionGuard],
  exports: [PermissionService, PermissionGuard, BaseNodePermissionGuard],
})
export class PermissionModule {}
