import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { AggregationModule } from '../aggregation/aggregation.module';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { FieldModule } from '../field/field.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { SelectionModule } from '../selection/selection.module';
import { ShareAuthModule } from './share-auth.module';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';

@Module({
  imports: [
    FieldModule,
    RecordModule,
    RecordOpenApiModule,
    SelectionModule,
    AggregationModule,
    ShareAuthModule,
    CollaboratorModule,
  ],
  providers: [ShareService, DbProvider],
  controllers: [ShareController],
  exports: [ShareService],
})
export class ShareModule {}
