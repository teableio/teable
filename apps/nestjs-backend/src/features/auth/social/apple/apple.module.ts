import { Module } from '@nestjs/common';
import { UserModule } from '../../../user/user.module';
import { OauthStoreService } from '../../oauth/oauth.store';
import { SessionModule } from '../../session/session.module';
import { AppleStrategy } from '../../strategies/apple.strategy';
import { AppleAuthExceptionFilter } from './apple-auth-exception.filter';
import { AppleController } from './apple.controller';

@Module({
  imports: [UserModule, SessionModule],
  providers: [AppleStrategy, OauthStoreService, AppleAuthExceptionFilter],
  exports: [],
  controllers: [AppleController],
})
export class AppleModule {}
