import { Module } from '@nestjs/common';
import { PrismaModule } from '@teable-group/db-main-prisma';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { FieldModule } from '../field.module';
import { FieldConvertingLinkService } from './field-converting-link.service';
import { FieldConvertingService } from './field-converting.service';
import { FieldCreatingService } from './field-creating.service';
import { FieldDeletingService } from './field-deleting.service';
import { FieldOpenApiController } from './field-open-api.controller';
import { FieldOpenApiService } from './field-open-api.service';

@Module({
  imports: [PrismaModule, FieldModule, ShareDbModule, CalculationModule, RecordOpenApiModule],
  controllers: [FieldOpenApiController],
  providers: [
    FieldOpenApiService,
    FieldConvertingService,
    FieldDeletingService,
    FieldCreatingService,
    FieldConvertingLinkService,
  ],
  exports: [FieldOpenApiService, FieldCreatingService],
})
export class FieldOpenApiModule {}
