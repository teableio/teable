import { Module } from '@nestjs/common';
import { RiskControlService } from './risk-control.service';

@Module({
  providers: [RiskControlService],
  exports: [RiskControlService],
})
export class RiskControlModule {}
