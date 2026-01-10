import { encode } from '@toon-format/toon';

export type CliOutput<T> =
  | {
      ok: true;
      command: string;
      input: Record<string, unknown>;
      data: T;
    }
  | {
      ok: false;
      command: string;
      input: Record<string, unknown>;
      error: {
        message: string;
        code?: string;
        tags?: string[];
        details?: Record<string, unknown>;
      };
    };

export const serializeError = (
  error: unknown
): { message: string; code?: string; tags?: string[]; details?: Record<string, unknown> } => {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    const message = typeof e.message === 'string' ? e.message : String(error);
    return {
      message,
      code: typeof e.code === 'string' ? e.code : undefined,
      tags: Array.isArray(e.tags) ? e.tags : undefined,
      details:
        typeof e.details === 'object' && e.details !== null
          ? (e.details as Record<string, unknown>)
          : undefined,
    };
  }
  return { message: String(error) };
};

export const printOutput = <T>(output: CliOutput<T>): void => {
  console.log(encode(output));
};

export const createSuccessOutput = <T>(
  command: string,
  input: Record<string, unknown>,
  data: T
): CliOutput<T> => ({
  ok: true,
  command,
  input,
  data,
});

export const createEmptyDataOutput = (
  command: string,
  input: Record<string, unknown>,
  hint: string
): CliOutput<never> => ({
  ok: false,
  command,
  input,
  error: {
    message: `No data found. ${hint}`,
    code: 'EMPTY_RESULT',
  },
});

export const isEmptyData = (data: unknown): boolean => {
  if (data === null || data === undefined) return true;
  if (Array.isArray(data) && data.length === 0) return true;
  return false;
};

export const createErrorOutput = (
  command: string,
  input: Record<string, unknown>,
  error: unknown
): CliOutput<never> => ({
  ok: false,
  command,
  input,
  error: serializeError(error),
});
