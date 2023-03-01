import { ApiProperty } from '@nestjs/swagger';
import type { IJsonApiSuccessResponse } from '@teable-group/core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class ApiResponse<T = any> implements IJsonApiSuccessResponse<T> {
  @ApiProperty({
    example: true,
    description: 'If success.',
  })
  // eslint-disable-next-line @typescript-eslint/prefer-as-const
  success: true = true;

  @ApiProperty({
    description: 'response data',
  })
  data!: T;

  setData(data?: T): ApiResponse<T> {
    data && (this.data = data);
    return this;
  }
}

export function responseWrap<T>(data: T) {
  return new ApiResponse<T>().setData(data);
}
