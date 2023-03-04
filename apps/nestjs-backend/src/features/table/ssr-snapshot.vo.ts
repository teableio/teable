import { ApiProperty } from '@nestjs/swagger';
import type { ITableSSrSnapshot } from '@teable-group/core';
import { ApiResponse } from 'src/utils/api-response';
import { FieldVo } from '../field/model/field.vo';
import { RecordsVo } from '../record/open-api/record.vo';
import { ViewVo } from '../view/model/view.vo';
import { TableVo } from './table.vo';

export class SnapshotVo implements ITableSSrSnapshot {
  @ApiProperty({ type: TableVo })
  table!: TableVo;

  @ApiProperty({ type: RecordsVo })
  recordData!: RecordsVo;

  @ApiProperty({ type: ViewVo, isArray: true })
  views!: ViewVo[];

  @ApiProperty({ type: FieldVo, isArray: true })
  fields!: FieldVo[];
}

export class SSRSnapshotVo extends ApiResponse<SnapshotVo> {
  @ApiProperty({ type: SnapshotVo })
  data!: SnapshotVo;
}
