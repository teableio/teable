import { Module } from '@nestjs/common';
import { UserModule } from '../../../user/user.module';
import { OauthStoreService } from '../../oauth/oauth.store';
import { GithubStrategy } from '../../strategies/github.strategy';
import { GithubController } from './github.controller';

@Module({
  imports: [UserModule],
  providers: [GithubStrategy, OauthStoreService],
  exports: [],
  controllers: [GithubController],
})
export class GithubModule {}
