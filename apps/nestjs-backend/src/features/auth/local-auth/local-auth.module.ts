import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import type { IAuthConfig } from '../../../configs/auth.config';
import { authConfig } from '../../../configs/auth.config';
import { MailSenderModule } from '../../mail-sender/mail-sender.module';
import { UserModule } from '../../user/user.module';
import { SessionStoreService } from '../session/session-store.service';
import { SessionModule } from '../session/session.module';
import { LocalStrategy } from '../strategies/local.strategy';
import { LocalAuthController } from './local-auth.controller';
import { LocalAuthService } from './local-auth.service';

@Module({
  imports: [
    UserModule,
    SessionModule,
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
  controllers: [LocalAuthController],
  exports: [LocalAuthService],
})
export class LocalAuthModule {}
