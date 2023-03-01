import { ApiProperty } from '@nestjs/swagger';
import { FieldVo } from '../model/field.vo';
import { ApiResponse } from '@/utils/api-response';

export class FieldResponseVo extends ApiResponse<FieldVo> {
  @ApiProperty({ type: FieldVo })
  override data!: FieldVo;
}
