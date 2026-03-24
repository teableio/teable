import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '../../cache/cache.module';
import { UserModule } from '../user/user.module';
import { externalOAuth2Config } from './external-oauth2.config';
import { ExternalOAuth2Controller } from './external-oauth2.controller';
import { ExternalOAuth2Service } from './external-oauth2.service';

@Module({
  imports: [ConfigModule.forFeature(externalOAuth2Config), CacheModule.register({}), UserModule],
  controllers: [ExternalOAuth2Controller],
  providers: [ExternalOAuth2Service],
  exports: [ExternalOAuth2Service],
})
export class ExternalOAuth2Module {}
