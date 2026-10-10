import { Module } from '@nestjs/common';
import { UserModule } from '../../../user/user.module';
import { OauthStoreService } from '../../oauth/oauth.store';
import { SessionModule } from '../../session/session.module';
import { OIDCStrategy } from '../../strategies/oidc.strategy';
import { OIDCController } from './oidc.controller';

@Module({
  imports: [UserModule, SessionModule],
  providers: [OIDCStrategy, OauthStoreService],
  exports: [],
  controllers: [OIDCController],
})
export class OIDCModule {}
