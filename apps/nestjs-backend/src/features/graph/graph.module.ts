import { Module } from '@nestjs/common';
import { BaseErdService } from './base-erd.service';

@Module({
  providers: [BaseErdService],
  exports: [BaseErdService],
})
export class GraphModule {}
