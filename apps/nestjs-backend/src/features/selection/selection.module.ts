import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../share-db/share-db.module';
import { FieldModule } from '../field/field.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { SelectionController } from './selection.controller';
import { SelectionService } from './selection.service';

@Module({
  imports: [RecordModule, FieldModule, ShareDbModule, RecordOpenApiModule, FieldOpenApiModule],
  controllers: [SelectionController],
  providers: [SelectionService],
  exports: [SelectionService],
})
export class SelectionModule {}
