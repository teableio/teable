import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { authConfig, type IAuthConfig } from '../../configs/auth.config';
import { AccessTokenModule } from '../access-token/access-token.module';
import { DeleteUserModule } from '../user/delete-user/delete-user.module';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './guard/auth.guard';
import { LocalAuthModule } from './local-auth/local-auth.module';
import { PermissionModule } from './permission.module';
import { SessionStoreService } from './session/session-store.service';
import { SessionModule } from './session/session.module';
import { SessionSerializer } from './session/session.serializer';
import { SocialModule } from './social/social.module';
import { AccessTokenStrategy } from './strategies/access-token.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SessionStrategy } from './strategies/session.strategy';
import { TurnstileModule } from './turnstile/turnstile.module';

@Module({
  imports: [
    UserModule,
    PassportModule.register({ session: true }),
    SessionModule,
    AccessTokenModule,
    ConditionalModule.registerWhen(LocalAuthModule, (env) => {
      return Boolean(env.PASSWORD_LOGIN_DISABLED !== 'true');
    }),
    SocialModule,
    PermissionModule,
    TurnstileModule,
    JwtModule.registerAsync({
      useFactory: (config: IAuthConfig) => ({
        secret: config.jwt.secret,
        signOptions: {
          expiresIn: config.jwt.expiresIn,
        },
      }),
      inject: [authConfig.KEY],
    }),
    DeleteUserModule,
  ],
  providers: [
    AuthService,
    SessionStrategy,
    AuthGuard,
    SessionSerializer,
    SessionStoreService,
    AccessTokenStrategy,
    JwtStrategy,
  ],
  exports: [AuthService, AuthGuard],
  controllers: [AuthController],
})
export class AuthModule {}
