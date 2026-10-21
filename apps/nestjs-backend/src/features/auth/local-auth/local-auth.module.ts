import { Module } from '@nestjs/common';
import { MailSenderModule } from '../../mail-sender/mail-sender.module';
import { SettingModule } from '../../setting/setting.module';
import { UserModule } from '../../user/user.module';
import { SessionStoreService } from '../session/session-store.service';
import { SessionModule } from '../session/session.module';
import { LocalStrategy } from '../strategies/local.strategy';
import { TurnstileModule } from '../turnstile/turnstile.module';
import { LocalAuthController } from './local-auth.controller';
import { LocalAuthService } from './local-auth.service';

@Module({
  imports: [TurnstileModule, SettingModule, UserModule, SessionModule, MailSenderModule.register()],
  providers: [LocalStrategy, LocalAuthService, SessionStoreService],
  controllers: [LocalAuthController],
  exports: [LocalAuthService],
})
export class LocalAuthModule {}
