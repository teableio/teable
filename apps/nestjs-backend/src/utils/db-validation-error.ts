/* eslint-disable @typescript-eslint/naming-convention */
export enum PostgresErrorCode {
  NOT_NULL_VIOLATION = '23502',
  UNIQUE_VIOLATION = '23505',
}

export enum SqliteErrorCode {
  NOT_NULL_VIOLATION = '1299',
  UNIQUE_VIOLATION = '2067',
}

export const handleDBValidationErrors = async ({
  fn,
  handleUniqueError,
  handleNotNullError,
}: {
  fn: () => Promise<unknown>;
  handleUniqueError: () => Promise<void>;
  handleNotNullError: () => Promise<void>;
}) => {
  try {
    await fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    const code = e.meta?.code ?? e.code;
    if (code === PostgresErrorCode.UNIQUE_VIOLATION || code === SqliteErrorCode.UNIQUE_VIOLATION) {
      return handleUniqueError();
    }
    if (
      code === PostgresErrorCode.NOT_NULL_VIOLATION ||
      code === SqliteErrorCode.NOT_NULL_VIOLATION
    ) {
      return handleNotNullError();
    }
    throw e;
  }
};
