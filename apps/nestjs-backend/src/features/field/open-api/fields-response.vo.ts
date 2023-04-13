import { ApiProperty } from '@nestjs/swagger';
import { ApiResponse } from '../../../utils/api-response';
import { FieldVo } from '../model/field.vo';

export class FieldsResponseVo extends ApiResponse<FieldVo[]> {
  @ApiProperty({ type: FieldVo, isArray: true })
  override data!: FieldVo[];
}
