import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { AccessTokenModule } from '../access-token/access-token.module';
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
import { SessionStrategy } from './strategies/session.strategy';

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
  ],
  providers: [
    AuthService,
    SessionStrategy,
    AuthGuard,
    SessionSerializer,
    SessionStoreService,
    AccessTokenStrategy,
  ],
  exports: [AuthService, AuthGuard],
  controllers: [AuthController],
})
export class AuthModule {}
