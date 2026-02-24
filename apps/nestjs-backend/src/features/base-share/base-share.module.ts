import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { authConfig } from '../../configs/auth.config';
import { AuthModule } from '../auth/auth.module';
import { PermissionModule } from '../auth/permission.module';
import { BaseModule } from '../base/base.module';
import { FieldModule } from '../field/field.module';
import { ViewModule } from '../view/view.module';
import { BaseShareAuthService } from './base-share-auth.service';
import { BaseShareOpenController } from './base-share-open.controller';
import { BaseShareController } from './base-share.controller';
import { BaseShareService } from './base-share.service';
import { BaseShareAuthLocalGuard } from './guard/base-share-auth-local.guard';
import { BaseShareAuthGuard } from './guard/base-share-auth.guard';
import { BaseShareJwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    AuthModule,
    PermissionModule,
    BaseModule,
    FieldModule,
    ViewModule,
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: authConfig().jwt.secret,
        signOptions: {
          expiresIn: '7d',
        },
      }),
    }),
  ],
  controllers: [BaseShareController, BaseShareOpenController],
  providers: [
    BaseShareService,
    BaseShareAuthService,
    BaseShareJwtStrategy,
    BaseShareAuthGuard,
    BaseShareAuthLocalGuard,
  ],
  exports: [BaseShareService, BaseShareAuthService],
})
export class BaseShareModule {}
