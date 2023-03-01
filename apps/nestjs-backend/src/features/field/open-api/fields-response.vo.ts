import { ApiProperty } from '@nestjs/swagger';
import { FieldVo } from '../model/field.vo';
import { ApiResponse } from '@/utils/api-response';

export class FieldsResponseVo extends ApiResponse<FieldVo[]> {
  @ApiProperty({ type: FieldVo, isArray: true })
  override data!: FieldVo[];
}
