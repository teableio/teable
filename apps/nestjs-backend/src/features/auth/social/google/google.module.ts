import { Module } from '@nestjs/common';
import { UserModule } from '../../../user/user.module';
import { OauthStoreService } from '../../oauth/oauth.store';
import { GoogleStrategy } from '../../strategies/google.strategy';
import { GoogleController } from './google.controller';

@Module({
  imports: [UserModule],
  providers: [GoogleStrategy, OauthStoreService],
  exports: [],
  controllers: [GoogleController],
})
export class GoogleModule {}
