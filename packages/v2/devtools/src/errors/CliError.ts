import { Data } from 'effect';

export class CliError extends Data.TaggedError('CliError')<{
  readonly message: string;
  readonly code?: string;
  readonly tags?: string[];
  readonly details?: Record<string, unknown>;
}> {
  static fromUnknown(error: unknown): CliError {
    if (error instanceof CliError) return error;

    if (error && typeof error === 'object') {
      const e = error as Record<string, unknown>;
      return new CliError({
        message: typeof e.message === 'string' ? e.message : String(error),
        code: typeof e.code === 'string' ? e.code : undefined,
        tags: Array.isArray(e.tags) ? e.tags : undefined,
        details:
          typeof e.details === 'object' && e.details !== null
            ? (e.details as Record<string, unknown>)
            : undefined,
      });
    }

    return new CliError({ message: String(error) });
  }
}

export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly message: string;
  readonly field?: string;
}> {}

export class SecurityError extends Data.TaggedError('SecurityError')<{
  readonly message: string;
  readonly code: string;
  readonly hint?: string;
}> {}
