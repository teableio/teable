import { Module } from '@nestjs/common';
import { UserModule } from '../../user/user.module';
import { SessionStoreService } from '../session/session-store.service';
import { CookieSessionGuard } from './cookie-session.guard';
import { MobileAuthController } from './mobile-auth.controller';
import { MobileAuthService } from './mobile-auth.service';

@Module({
  imports: [UserModule],
  providers: [MobileAuthService, SessionStoreService, CookieSessionGuard],
  controllers: [MobileAuthController],
  exports: [MobileAuthService],
})
export class MobileAuthModule {}
