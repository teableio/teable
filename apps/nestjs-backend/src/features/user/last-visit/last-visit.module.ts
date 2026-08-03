import { Module } from '@nestjs/common';
import { LastVisitController } from './last-visit.controller';
import { LastVisitService } from './last-visit.service';

@Module({
  controllers: [LastVisitController],
  providers: [LastVisitService],
  exports: [LastVisitService],
})
export class LastVisitModule {}
