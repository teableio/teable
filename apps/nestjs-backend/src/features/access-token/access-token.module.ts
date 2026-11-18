import { Module } from '@nestjs/common';
import { AccessTokenLegacyCipherService } from './access-token-legacy-cipher.service';
import { AccessTokenController } from './access-token.controller';
import { AccessTokenService } from './access-token.service';

@Module({
  providers: [AccessTokenService, AccessTokenLegacyCipherService],
  controllers: [AccessTokenController],
  exports: [AccessTokenService, AccessTokenLegacyCipherService],
})
export class AccessTokenModule {}
