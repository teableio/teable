import { Module } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { RecordModule } from '../record.module';
import { RecordOpenApiController } from './record-open-api.controller';
import { RecordOpenApiService } from './record-open-api.service';

@Module({
  imports: [RecordModule, ShareDbModule, CalculationModule],
  controllers: [RecordOpenApiController],
  providers: [RecordOpenApiService, PrismaService],
  exports: [RecordOpenApiService],
})
export class RecordOpenApiModule {}
