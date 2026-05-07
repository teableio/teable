import { Module } from '@nestjs/common';
import { UsageController } from './usage.controller';

@Module({
  controllers: [UsageController],
})
export class UsageModule {}
