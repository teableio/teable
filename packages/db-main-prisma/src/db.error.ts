/* eslint-disable @typescript-eslint/naming-convention */
export enum PostgresErrorCode {
  NOT_NULL_VIOLATION = '23502',
  UNIQUE_VIOLATION = '23505',
}

export enum SqliteErrorCode {
  NOT_NULL_VIOLATION = '1299',
  UNIQUE_VIOLATION = '2067',
}
