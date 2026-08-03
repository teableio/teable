import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { authConfig, type IAuthConfig } from '../../configs/auth.config';
import { DbProvider } from '../../db-provider/db.provider';
import { AuthModule } from '../auth/auth.module';
import { ShareAuthGuard } from './guard/auth.guard';
import { ShareAuthService } from './share-auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    AuthModule,
    PassportModule,
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
  providers: [JwtStrategy, ShareAuthService, DbProvider, ShareAuthGuard],
  exports: [ShareAuthService, ShareAuthGuard],
})
export class ShareAuthModule {}
