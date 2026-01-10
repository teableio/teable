import type { Effect } from 'effect';
import { Context } from 'effect';

export type CliOutput<T> =
  | { ok: true; command: string; input: Record<string, unknown>; data: T }
  | { ok: false; command: string; input: Record<string, unknown>; error: CliErrorInfo };

export interface CliErrorInfo {
  message: string;
  code?: string;
  tags?: string[];
  details?: Record<string, unknown>;
}

export class Output extends Context.Tag('Output')<
  Output,
  {
    readonly print: <T>(output: CliOutput<T>) => Effect.Effect<void>;
    readonly success: <T>(
      command: string,
      input: Record<string, unknown>,
      data: T
    ) => Effect.Effect<void>;
    readonly error: (
      command: string,
      input: Record<string, unknown>,
      error: unknown
    ) => Effect.Effect<void>;
    readonly empty: (
      command: string,
      input: Record<string, unknown>,
      hint: string
    ) => Effect.Effect<void>;
  }
>() {}
