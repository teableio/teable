import { Module } from '@nestjs/common';
import { TrackingController } from './tracking.controller';

@Module({
  controllers: [TrackingController],
})
export class TrackingModule {}
