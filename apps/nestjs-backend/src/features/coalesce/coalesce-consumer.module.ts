import { Module } from '@nestjs/common';
import { CoalesceModule } from './coalesce.module';
import { CoalesceProcessor } from './coalesce.processor';

// queue consumer: mounted by the app root only
@Module({
  imports: [CoalesceModule],
  providers: [CoalesceProcessor],
})
export class CoalesceConsumerModule {}
