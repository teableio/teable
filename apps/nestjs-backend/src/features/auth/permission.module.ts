import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PermissionGuard } from './guard/permission.guard';
import { PermissionService } from './permission.service';

@Global()
@Module({
  providers: [
    PermissionService,
    PermissionGuard,
    {
      provide: APP_GUARD,
      useClass: PermissionGuard,
    },
  ],
  exports: [PermissionService, PermissionGuard],
})
export class PermissionModule {}
