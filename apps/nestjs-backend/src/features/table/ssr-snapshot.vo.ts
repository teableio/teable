import { ApiProperty } from '@nestjs/swagger';
import type { IFullSsrSnapshot, ITableVo } from '@teable-group/core';
import { ApiResponse } from '../../utils/api-response';
import { FieldVo } from '../field/model/field.vo';
import { RecordsVo } from '../record/open-api/record.vo';
import { ViewVo } from '../view/model/view.vo';
import { TableVo } from './table.vo';

export class FullSnapshotVo implements IFullSsrSnapshot {
  @ApiProperty({ type: RecordsVo })
  rows!: RecordsVo;

  @ApiProperty({ type: TableVo, isArray: true })
  tables!: ITableVo[];

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
  tables!: ITableVo[];
}

export class TableSSRSnapshotVo extends ApiResponse<TableSnapshotVo> {
  @ApiProperty({ type: TableSnapshotVo })
  data!: TableSnapshotVo;
}

export class DefaultViewVo {
  @ApiProperty({
    description: 'default view id in table',
  })
  id!: string;
}

export class TableSSRDefaultViewIdVo extends ApiResponse<DefaultViewVo> {
  @ApiProperty({ type: DefaultViewVo })
  data!: DefaultViewVo;
}
