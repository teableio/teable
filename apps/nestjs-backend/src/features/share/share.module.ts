import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { AggregationModule } from '../aggregation/aggregation.module';
import { AuthModule } from '../auth/auth.module';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { FieldModule } from '../field/field.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { SelectionModule } from '../selection/selection.module';
import { ViewModule } from '../view/view.module';
import { ShareAuthModule } from './share-auth.module';
import { ShareSocketService } from './share-socket.service';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';

@Module({
  imports: [
    AuthModule,
    FieldModule,
    RecordModule,
    RecordOpenApiModule,
    SelectionModule,
    AggregationModule,
    ShareAuthModule,
    CollaboratorModule,
    ViewModule,
  ],
  providers: [ShareService, DbProvider, ShareSocketService],
  controllers: [ShareController],
  exports: [ShareService, ShareSocketService],
})
export class ShareModule {}
