import type { ZodError } from 'zod';

export const formatFieldErrorMessage = (error: ZodError<unknown>) => {
  console.log('formatFieldErrorMessage:', error);
  return error.format()._errors.join('\n');
};
