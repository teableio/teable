import { Module } from '@nestjs/common';
import { NextController } from './next.controller';
import { NextService } from './next.service';

@Module({
  providers: [NextService],
  controllers: [NextController],
})
export class NextModule {}
