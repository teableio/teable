import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { authConfig, type IAuthConfig } from '../../configs/auth.config';
import { PermissionGuard } from './guard/permission.guard';
import { PermissionService } from './permission.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (config: IAuthConfig) => ({
        secret: config.jwt.secret,
        signOptions: {
          expiresIn: config.jwt.expiresIn,
        },
      }),
      inject: [authConfig.KEY],
    }),
  ],
  providers: [PermissionService, PermissionGuard],
  exports: [PermissionService, PermissionGuard],
})
export class PermissionModule {}
