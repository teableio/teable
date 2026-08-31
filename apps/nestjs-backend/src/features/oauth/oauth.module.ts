import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { DistributedLockModule } from '../../distributed-lock';
import { AccessTokenModule } from '../access-token/access-token.module';
import { OAuthAppInitService } from './oauth-app-init.service';
import { OAuthDeviceService } from './oauth-device.service';
import { OAuthServerController } from './oauth-server.controller';
import { OAuthServerService } from './oauth-server.service';
import { OAuthTxStore } from './oauth-tx-store';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { PkceService } from './pkce.service';
import { OAuthClientStrategy } from './strategies/oauth2-client.strategies';
import { OAuthPkceClientStrategy } from './strategies/oauth2-pkce-client.strategy';

@Module({
  imports: [AccessTokenModule, DistributedLockModule, PassportModule.register({ session: true })],
  controllers: [OAuthController, OAuthServerController],
  providers: [
    OAuthDeviceService,
    OAuthServerService,
    OAuthService,
    OAuthAppInitService,
    OAuthClientStrategy,
    OAuthPkceClientStrategy,
    OAuthTxStore,
    PkceService,
  ],
  exports: [OAuthService],
})
export class OAuthModule {}
