import type { HttpError } from '@teable-group/core';

export const getError = async (call: () => unknown) => {
  try {
    await call();
    return;
  } catch (error: unknown) {
    return error as HttpError;
  }
};
