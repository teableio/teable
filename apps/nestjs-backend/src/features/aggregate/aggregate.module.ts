import { Module } from '@nestjs/common';
import { AggregateListener } from './listeners/aggregate.listener';
import { PrismaService } from '../../prisma.service';
import { ShareDbModule } from '../../share-db/share-db.module';
import { AggregateService } from './aggregate.service';

@Module({
  imports: [ShareDbModule],
  providers: [AggregateService, PrismaService, AggregateListener],
  exports: [AggregateService],
})
export class AggregateModule {}
