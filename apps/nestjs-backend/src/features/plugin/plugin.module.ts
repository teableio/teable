import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { authConfig, type IAuthConfig } from '../../configs/auth.config';
import { AccessTokenModule } from '../access-token/access-token.module';
import { UserModule } from '../user/user.module';
import { PluginAuthService } from './plugin-auth.service';
import { PluginController } from './plugin.controller';
import { PluginService } from './plugin.service';

@Module({
  imports: [
    UserModule,
    AccessTokenModule,
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
  providers: [PluginService, PluginAuthService],
  controllers: [PluginController],
})
export class PluginModule {}
