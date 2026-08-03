import { Module } from '@nestjs/common';
import { FieldReadonlyServiceAdapter } from './field-readonly.service';
import { RecordReadonlyServiceAdapter } from './record-readonly.service';
import { TableReadonlyServiceAdapter } from './table-readonly.service';
import { ViewReadonlyServiceAdapter } from './view-readonly.service';

@Module({
  imports: [],
  providers: [
    RecordReadonlyServiceAdapter,
    FieldReadonlyServiceAdapter,
    ViewReadonlyServiceAdapter,
    TableReadonlyServiceAdapter,
  ],
  exports: [
    RecordReadonlyServiceAdapter,
    FieldReadonlyServiceAdapter,
    ViewReadonlyServiceAdapter,
    TableReadonlyServiceAdapter,
  ],
})
export class ReadonlyModule {}
