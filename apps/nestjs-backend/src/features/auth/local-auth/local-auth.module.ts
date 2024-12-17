import { Module } from '@nestjs/common';
import { UserModule } from '../../user/user.module';
import { SessionStoreService } from '../session/session-store.service';
import { SessionModule } from '../session/session.module';
import { LocalStrategy } from '../strategies/local.strategy';
import { LocalAuthController } from './local-auth.controller';
import { LocalAuthService } from './local-auth.service';

@Module({
  imports: [UserModule, SessionModule],
  providers: [LocalStrategy, LocalAuthService, SessionStoreService],
  controllers: [LocalAuthController],
  exports: [LocalAuthService],
})
export class LocalAuthModule {}
