import { ApiProperty } from '@nestjs/swagger';
import { ApiResponse } from '../../../utils/api-response';
import { FieldVo } from '../model/field.vo';

export class FieldResponseVo extends ApiResponse<FieldVo> {
  @ApiProperty({ type: FieldVo })
  override data!: FieldVo;
}
