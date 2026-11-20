import { Module } from '@nestjs/common';
import { RawOpStagingService } from './raw-op-staging.service';

@Module({
  providers: [RawOpStagingService],
  exports: [RawOpStagingService],
})
export class RawOpStagingModule {}
