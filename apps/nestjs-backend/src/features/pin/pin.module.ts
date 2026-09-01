import { Module } from '@nestjs/common';
import { LastVisitModule } from '../user/last-visit/last-visit.module';
import { PinController } from './pin.controller';
import { PinService } from './pin.service';

@Module({
  imports: [LastVisitModule],
  providers: [PinService],
  controllers: [PinController],
})
export class PinModule {}
