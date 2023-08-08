import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import { AggregateModule } from '../aggregate.module';
import { AggregateService } from '../aggregate.service';
import { AggregateOpenApiController } from './aggregate-open-api.controller';

@Module({
  controllers: [AggregateOpenApiController],
  imports: [AggregateModule],
  providers: [AggregateService, PrismaService],
  exports: [AggregateService],
})
export class AggregateOpenApiModule {}
