/* eslint-disable @typescript-eslint/naming-convention */
import { HttpException, HttpStatus } from '@nestjs/common';

export enum PostgresErrorCode {
  NOT_NULL_VIOLATION = '23502',
  UNIQUE_VIOLATION = '23505',
}

export enum SqliteErrorCode {
  NOT_NULL_VIOLATION = '1299',
  UNIQUE_VIOLATION = '2067',
}

export const handleDBValidationErrors = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    const code = e.meta?.code ?? e.code;
    if (code === PostgresErrorCode.UNIQUE_VIOLATION || code === SqliteErrorCode.UNIQUE_VIOLATION) {
      throw new HttpException(
        'Duplicate detected! Please ensure that all fields with unique value validation are indeed unique.',
        HttpStatus.BAD_REQUEST
      );
    }
    if (
      code === PostgresErrorCode.NOT_NULL_VIOLATION ||
      code === SqliteErrorCode.NOT_NULL_VIOLATION
    ) {
      throw new HttpException(
        'One or more required fields were not provided! Please ensure all mandatory fields are filled.',
        HttpStatus.BAD_REQUEST
      );
    }
    throw new HttpException(`An error occurred: ${e.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
  }
};
