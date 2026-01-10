import { encode } from '@toon-format/toon';
import { Console, Layer } from 'effect';
import { Output, type CliOutput, type CliErrorInfo } from '../services/Output';

const serializeError = (error: unknown): CliErrorInfo => {
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

export const OutputLive = Layer.succeed(Output, {
  print: <T>(output: CliOutput<T>) => Console.log(encode(output)),

  success: <T>(command: string, input: Record<string, unknown>, data: T) =>
    Console.log(encode({ ok: true, command, input, data })),

  error: (command: string, input: Record<string, unknown>, error: unknown) =>
    Console.log(encode({ ok: false, command, input, error: serializeError(error) })),

  empty: (command: string, input: Record<string, unknown>, hint: string) =>
    Console.log(
      encode({
        ok: false,
        command,
        input,
        error: { message: `No data found. ${hint}`, code: 'EMPTY_RESULT' },
      })
    ),
});
