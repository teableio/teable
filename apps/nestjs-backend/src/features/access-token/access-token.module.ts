import { Module } from '@nestjs/common';
import { AccessTokenController } from './access-token.controller';
import { AccessTokenService } from './access-token.service';

@Module({
  providers: [AccessTokenService],
  controllers: [AccessTokenController],
  exports: [AccessTokenService],
})
export class AccessTokenModule {}
