import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../share-db/share-db.module';
import { FieldModule } from '../field/field.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { SelectionController } from './selection.controller';
import { SelectionService } from './selection.service';

@Module({
  providers: [SelectionService],
  controllers: [SelectionController],
  imports: [RecordModule, FieldModule, ShareDbModule, RecordOpenApiModule, FieldOpenApiModule],
  exports: [SelectionService],
})
export class SelectionModule {}
