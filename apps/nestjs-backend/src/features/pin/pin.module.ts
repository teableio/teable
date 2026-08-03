import { Module } from '@nestjs/common';
import { PinController } from './pin.controller';
import { PinService } from './pin.service';

@Module({
  providers: [PinService],
  controllers: [PinController],
})
export class PinModule {}
