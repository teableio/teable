import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import type { IAuthConfig } from '../../../configs/auth.config';
import { authConfig } from '../../../configs/auth.config';
import { MailSenderModule } from '../../mail-sender/mail-sender.module';
import { ModelModule } from '../../model/model.module';
import { SettingModule } from '../../setting/setting.module';
import { UserModule } from '../../user/user.module';
import { SessionStoreService } from '../session/session-store.service';
import { SessionModule } from '../session/session.module';
import { LocalStrategy } from '../strategies/local.strategy';
import { TurnstileModule } from '../turnstile/turnstile.module';
import { AutoLoginController } from './auto-login.controller';
import { LocalAuthController } from './local-auth.controller';
import { LocalAuthService } from './local-auth.service';
import { AccessTokenModule } from '../../access-token/access-token.module';

@Module({
  imports: [
    TurnstileModule,
    SettingModule,
    UserModule,
    ModelModule,
    SessionModule,
    AccessTokenModule,
    MailSenderModule.register(),
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
  providers: [LocalStrategy, LocalAuthService, SessionStoreService],
  controllers: [LocalAuthController, AutoLoginController],
  exports: [LocalAuthService],
})
export class LocalAuthModule {}
