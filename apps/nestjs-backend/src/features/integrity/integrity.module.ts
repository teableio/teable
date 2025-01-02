import { Module } from '@nestjs/common';
import { IntegrityController } from './integrity.controller';
import { LinkIntegrityService } from './link-integrity.service';

@Module({
  controllers: [IntegrityController],
  providers: [LinkIntegrityService],
  exports: [LinkIntegrityService],
})
export class IntegrityModule {}
