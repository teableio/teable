import { Module } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { FieldModule } from '../field.module';
import { FieldConvertingService } from './field-converting.service';
import { FieldCreatingService } from './field-creating.service';
import { FieldDeletingService } from './field-deleting.service';
import { FieldOpenApiController } from './field-open-api.controller';
import { FieldOpenApiService } from './field-open-api.service';

@Module({
  imports: [FieldModule, ShareDbModule, CalculationModule],
  controllers: [FieldOpenApiController],
  providers: [
    PrismaService,
    FieldOpenApiService,
    FieldConvertingService,
    FieldDeletingService,
    FieldCreatingService,
  ],
  exports: [FieldOpenApiService],
})
export class FieldOpenApiModule {}
