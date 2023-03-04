import { ApiProperty } from '@nestjs/swagger';
import type { IFullSsrSnapshot } from '@teable-group/core';
import { ApiResponse } from 'src/utils/api-response';
import { FieldVo } from '../field/model/field.vo';
import { RecordsVo } from '../record/open-api/record.vo';
import { ViewVo } from '../view/model/view.vo';
import { TableVo } from './table.vo';

export class FullSnapshotVo implements IFullSsrSnapshot {
  @ApiProperty({ type: RecordsVo })
  recordData!: RecordsVo;

  @ApiProperty({ type: TableVo, isArray: true })
  tables!: TableVo[];

  @ApiProperty({ type: ViewVo, isArray: true })
  views!: ViewVo[];

  @ApiProperty({ type: FieldVo, isArray: true })
  fields!: FieldVo[];
}

export class FullSSRSnapshotVo extends ApiResponse<FullSnapshotVo> {
  @ApiProperty({ type: FullSnapshotVo })
  data!: FullSnapshotVo;
}

export class TableSnapshotVo implements Pick<IFullSsrSnapshot, 'tables'> {
  @ApiProperty({ type: TableVo, isArray: true })
  tables!: TableVo[];
}

export class TableSSRSnapshotVo extends ApiResponse<TableSnapshotVo> {
  @ApiProperty({ type: TableSnapshotVo })
  data!: TableSnapshotVo;
}
