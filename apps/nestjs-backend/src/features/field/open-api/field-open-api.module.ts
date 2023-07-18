import { Module } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { FieldModule } from '../field.module';
import { FieldOpenApiController } from './field-open-api.controller';
import { FieldOpenApiService } from './field-open-api.service';

@Module({
  imports: [FieldModule, ShareDbModule, CalculationModule, RecordOpenApiModule],
  controllers: [FieldOpenApiController],
  providers: [FieldOpenApiService, PrismaService],
  exports: [FieldOpenApiService],
})
export class FieldOpenApiModule {}
