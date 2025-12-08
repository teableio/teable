import { Global, Module } from '@nestjs/common';
import { PermissionGuard } from './guard/permission.guard';
import { PermissionService } from './permission.service';

@Global()
@Module({
  providers: [PermissionService, PermissionGuard],
  exports: [PermissionService, PermissionGuard],
})
export class PermissionModule {}
