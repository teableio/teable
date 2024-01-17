import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './guard/auth.guard';
import { SessionStoreService } from './session/session-store.service';
import { SessionModule } from './session/session.module';
import { SessionSerializer } from './session/session.serializer';
import { LocalStrategy } from './strategies/local.strategy';
import { SessionStrategy } from './strategies/session.strategy';

@Module({
  imports: [UserModule, PassportModule.register({ session: true }), SessionModule],
  providers: [
    AuthService,
    LocalStrategy,
    SessionStrategy,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    AuthGuard,
    SessionSerializer,
    SessionStoreService,
  ],
  exports: [AuthService, AuthGuard],
  controllers: [AuthController],
})
export class AuthModule {}
