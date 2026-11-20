import { Module } from '@nestjs/common';
import { CrossSpaceLinkConversionRecoveryService } from './cross-space-link-conversion-recovery.service';

@Module({
  providers: [CrossSpaceLinkConversionRecoveryService],
  exports: [CrossSpaceLinkConversionRecoveryService],
})
export class PairConversionRecoveryModule {}
