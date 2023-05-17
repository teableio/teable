import type { ZodError } from 'zod';

export const formatFieldErrorMessage = (error: ZodError<unknown>) => {
  return error.format()._errors[0];
};
