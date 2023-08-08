import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AggregateService } from './aggregate.service';

@Module({
  providers: [AggregateService, PrismaService],
  exports: [AggregateService],
})
export class AggregateModule {}
