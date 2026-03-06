import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { authConfig, type IAuthConfig } from '../../configs/auth.config';
import { AccessTokenModule } from '../access-token/access-token.module';
import { OAuthServerController } from './oauth-server.controller';
import { OAuthServerService } from './oauth-server.service';
import { OAuthTxStore } from './oauth-tx-store';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { PkceService } from './pkce.service';
import { OAuthClientStrategy } from './strategies/oauth2-client.strategies';
import { OAuthPkceClientStrategy } from './strategies/oauth2-pkce-client.strategy';

@Module({
  imports: [
    AccessTokenModule,
    PassportModule.register({ session: true }),
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
  controllers: [OAuthController, OAuthServerController],
  providers: [
    OAuthServerService,
    OAuthService,
    OAuthClientStrategy,
    OAuthPkceClientStrategy,
    OAuthTxStore,
    PkceService,
  ],
  exports: [OAuthService],
})
export class OAuthModule {}
